import { app, shell, BrowserWindow, ipcMain } from 'electron'
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import { dirname, join } from 'path'
import { existsSync } from 'fs'
import { mkdir, readFile, writeFile } from 'fs/promises'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'

const ACTIVITYWATCH_PORT = 5600
const ACTIVITYWATCH_BASE_URL = `http://127.0.0.1:${ACTIVITYWATCH_PORT}`
const ACTIVITYWATCH_INFO_URL = `http://127.0.0.1:${ACTIVITYWATCH_PORT}/api/0/info`
const ACTIVITYWATCH_STARTUP_TIMEOUT_MS = 20_000
const ACTIVITYWATCH_POLL_INTERVAL_MS = 500
const ACTIVITYWATCH_EVENT_POLL_INTERVAL_MS = 2_000
const CLASSIFICATION_DEBOUNCE_MS = 30_000
const CLASSIFICATION_API_URL = 'http://127.0.0.1:5001/classify'
const CLASSIFICATION_HISTORY_LIMIT = 500
const PROJECT_ROOT = process.cwd()
const GOALS_FILE_PATH = join(process.cwd(), 'backend', 'goals.json')
const SIDECAR_SCRIPT_PATH = join(PROJECT_ROOT, 'backend', 'sidecar', 'analyzer.py')
const ENV_FILE_PATH = join(PROJECT_ROOT, '.env')

let awServerProcess: ChildProcessWithoutNullStreams | null = null
let awWatcherWindowProcess: ChildProcessWithoutNullStreams | null = null
let analyzerSidecarProcess: ChildProcessWithoutNullStreams | null = null
let awWindowBucketId: string | null = null
let awEventsPollTimer: NodeJS.Timeout | null = null
let awEventsPollInFlight = false
let classificationDebounceTimer: NodeJS.Timeout | null = null
let awLatestWindowEvent: ActivityWatchEvent | null = null
let latestClassificationResult: ClassificationEntry | null = null
let awLastChecked = new Date().toISOString()
const awSeenEventIds = new Set<number>()
const classificationHistory: ClassificationEntry[] = []

interface ActivityWatchEventData {
  app?: string
  title?: string
  [key: string]: unknown
}

interface ActivityWatchEvent {
  id?: number
  timestamp: string
  duration: number
  data: ActivityWatchEventData
  [key: string]: unknown
}

interface ClassificationResult {
  onGoal: boolean
  confidence: number
  reasoning: string
}

interface ClassificationEntry extends ClassificationResult {
  timestamp: string
  app: string
  title: string
}

function sanitizeGoals(goals: unknown): string[] {
  if (!Array.isArray(goals)) return []

  return goals
    .filter((goal): goal is string => typeof goal === 'string')
    .map((goal) => goal.trim())
    .filter((goal) => goal.length > 0)
    .slice(0, 1)
}

async function ensureGoalsFileExists(): Promise<void> {
  await mkdir(dirname(GOALS_FILE_PATH), { recursive: true })

  if (!existsSync(GOALS_FILE_PATH)) {
    await writeFile(GOALS_FILE_PATH, '[]\n', 'utf8')
  }
}

async function getGoals(): Promise<string[]> {
  await ensureGoalsFileExists()

  try {
    const content = await readFile(GOALS_FILE_PATH, 'utf8')
    return sanitizeGoals(JSON.parse(content))
  } catch (error) {
    console.error('[goals] failed reading goals file, defaulting to empty list:', error)
    return []
  }
}

async function setGoals(goals: string[]): Promise<string[]> {
  await ensureGoalsFileExists()
  const sanitizedGoals = sanitizeGoals(goals)
  await writeFile(GOALS_FILE_PATH, `${JSON.stringify(sanitizedGoals, null, 2)}\n`, 'utf8')
  return sanitizedGoals
}

function getActivityWatchPlatform(): string {
  if (process.platform === 'darwin') return 'macos'
  if (process.platform === 'win32') return 'windows'
  return 'linux'
}

function resolveActivityWatchRoot(): string {
  const platformDir = getActivityWatchPlatform()
  const candidates = [
    join(process.resourcesPath, 'activitywatch', platformDir),
    join(process.resourcesPath, 'app.asar.unpacked', 'resources', 'activitywatch', platformDir),
    join(app.getAppPath(), 'resources', 'activitywatch', platformDir),
    join(app.getAppPath(), '..', 'resources', 'activitywatch', platformDir),
    join(__dirname, '../../resources/activitywatch', platformDir)
  ]

  const resolved = candidates.find((candidate) => existsSync(candidate))
  if (!resolved) {
    throw new Error(`ActivityWatch binaries not found. Checked: ${candidates.join(', ')}`)
  }

  return resolved
}

function resolveBinaryPath(baseDir: string, binaryFolder: string, binaryName: string): string {
  const executableName = process.platform === 'win32' ? `${binaryName}.exe` : binaryName
  return join(baseDir, binaryFolder, executableName)
}

function resolveVenvPythonPath(): string {
  if (process.platform === 'win32') {
    return join(PROJECT_ROOT, '.venv', 'Scripts', 'python.exe')
  }

  return join(PROJECT_ROOT, '.venv', 'bin', 'python')
}

function buildActivityWatchEnv(baseDir: string, binaryDir: string): NodeJS.ProcessEnv {
  const env = { ...process.env }
  const separator = process.platform === 'win32' ? ';' : ':'
  const libraryPaths = [baseDir, binaryDir]

  if (process.platform === 'linux') {
    env.LD_LIBRARY_PATH = [libraryPaths.join(separator), process.env.LD_LIBRARY_PATH]
      .filter(Boolean)
      .join(separator)
  }

  if (process.platform === 'darwin') {
    env.DYLD_LIBRARY_PATH = [libraryPaths.join(separator), process.env.DYLD_LIBRARY_PATH]
      .filter(Boolean)
      .join(separator)
  }

  return env
}

function attachProcessLogging(
  label: string,
  childProcess: ChildProcessWithoutNullStreams
): ChildProcessWithoutNullStreams {
  childProcess.stdout.on('data', (chunk) => {
    const output = chunk.toString().trim()
    if (output) console.log(`[${label}] ${output}`)
  })

  childProcess.stderr.on('data', (chunk) => {
    const output = chunk.toString().trim()
    if (output) console.error(`[${label}] ${output}`)
  })

  childProcess.on('error', (error) => {
    console.error(`[${label}] failed to start:`, error)
  })

  childProcess.on('exit', (code, signal) => {
    console.log(`[${label}] exited with code ${code ?? 'null'} signal ${signal ?? 'null'}`)
  })

  return childProcess
}

async function isActivityWatchServerHealthy(timeoutMs = 1_000): Promise<boolean> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(ACTIVITYWATCH_INFO_URL, { signal: controller.signal })
    return response.ok
  } catch {
    return false
  } finally {
    clearTimeout(timeoutId)
  }
}

async function waitForActivityWatchServerReady(): Promise<void> {
  const deadline = Date.now() + ACTIVITYWATCH_STARTUP_TIMEOUT_MS

  while (Date.now() < deadline) {
    if (await isActivityWatchServerHealthy()) {
      return
    }

    await new Promise((resolve) => setTimeout(resolve, ACTIVITYWATCH_POLL_INTERVAL_MS))
  }

  throw new Error(
    `Timed out waiting for ActivityWatch server at ${ACTIVITYWATCH_INFO_URL} after ${ACTIVITYWATCH_STARTUP_TIMEOUT_MS}ms`
  )
}

async function discoverWindowBucketId(): Promise<string | null> {
  try {
    const response = await fetch(`${ACTIVITYWATCH_BASE_URL}/api/0/buckets/`)
    if (!response.ok) {
      throw new Error(`Bucket discovery failed with status ${response.status}`)
    }

    const buckets = (await response.json()) as Record<string, unknown>
    const bucketId = Object.keys(buckets).find((id) => id.startsWith('aw-watcher-window_')) ?? null

    if (bucketId) {
      console.log(`[aw-poll] using window bucket ${bucketId}`)
    } else {
      console.warn('[aw-poll] no aw-watcher-window bucket found yet')
    }

    return bucketId
  } catch (error) {
    console.error('[aw-poll] failed to discover buckets:', error)
    return null
  }
}

function computeNextLastChecked(events: ActivityWatchEvent[], fallbackIso: string): string {
  const newestTimestamp = events[events.length - 1]?.timestamp
  if (typeof newestTimestamp !== 'string') return fallbackIso

  const timestampMs = Date.parse(newestTimestamp)
  if (Number.isNaN(timestampMs)) return fallbackIso

  // Add 1ms to avoid re-reading the latest event when `start` is inclusive.
  return new Date(timestampMs + 1).toISOString()
}

function broadcastLatestWindowEvent(event: ActivityWatchEvent): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send('activitywatch:latest-event', event)
    }
  }
}

function broadcastActivityWatchHeartbeat(event: ActivityWatchEvent): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send('activitywatch:heartbeat', event)
    }
  }
}

function broadcastLatestClassification(result: ClassificationEntry): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send('classification:latest', result)
    }
  }
}

function buildHeartbeatEvent(event: ActivityWatchEvent, timestamp: string): ActivityWatchEvent {
  return { ...event, timestamp }
}

async function classifyEventWithCurrentGoal(event: ActivityWatchEvent): Promise<void> {
  const goals = await getGoals()
  const goal = goals[0] ?? ''
  const appName = event.data.app ?? ''
  const title = event.data.title ?? ''

  try {
    const response = await fetch(CLASSIFICATION_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ app: appName, title, goal })
    })

    if (!response.ok) {
      throw new Error(`Classification request failed with status ${response.status}`)
    }

    const rawResult = (await response.json()) as Partial<ClassificationResult>
    const classification: ClassificationEntry = {
      timestamp: new Date().toISOString(),
      app: appName,
      title,
      onGoal: Boolean(rawResult.onGoal),
      confidence: typeof rawResult.confidence === 'number' ? rawResult.confidence : 0,
      reasoning: typeof rawResult.reasoning === 'string' ? rawResult.reasoning : ''
    }

    latestClassificationResult = classification
    classificationHistory.push(classification)
    if (classificationHistory.length > CLASSIFICATION_HISTORY_LIMIT) {
      classificationHistory.splice(0, classificationHistory.length - CLASSIFICATION_HISTORY_LIMIT)
    }
    console.log('[classification]', classification)
    broadcastLatestClassification(classification)
  } catch (error) {
    console.error('[classification] failed:', error)
  }
}

function scheduleDebouncedClassification(event: ActivityWatchEvent): void {
  if (classificationDebounceTimer) {
    clearTimeout(classificationDebounceTimer)
  }

  classificationDebounceTimer = setTimeout(() => {
    void classifyEventWithCurrentGoal(event)
  }, CLASSIFICATION_DEBOUNCE_MS)
}

async function pollActivityWatchWindowEvents(): Promise<void> {
  if (awEventsPollInFlight) return

  awEventsPollInFlight = true
  const pollStartedAt = new Date().toISOString()

  try {
    if (!awWindowBucketId) {
      awWindowBucketId = await discoverWindowBucketId()
      if (!awWindowBucketId) return
    }

    const bucketUrl = `${ACTIVITYWATCH_BASE_URL}/api/0/buckets/${encodeURIComponent(awWindowBucketId)}/events`
    const response = await fetch(`${bucketUrl}?start=${encodeURIComponent(awLastChecked)}`)

    if (response.status === 404) {
      console.warn(`[aw-poll] bucket ${awWindowBucketId} not found, rediscovering`)
      awWindowBucketId = null
      return
    }

    if (!response.ok) {
      throw new Error(`Event polling failed with status ${response.status}`)
    }

    const events = (await response.json()) as ActivityWatchEvent[]
    if (events.length > 0) {
      const newEvents = events.filter((event) => {
        const eventId = (event as { id?: unknown }).id
        if (typeof eventId !== 'number') {
          return true
        }

        if (awSeenEventIds.has(eventId)) {
          return false
        }

        awSeenEventIds.add(eventId)
        return true
      })

      for (const event of newEvents) {
        console.log('[aw-event]', event)
      }

      if (newEvents.length > 0) {
        awLatestWindowEvent = newEvents[newEvents.length - 1]
        broadcastLatestWindowEvent(awLatestWindowEvent)
        scheduleDebouncedClassification(awLatestWindowEvent)
      }

      awLastChecked = computeNextLastChecked(events, pollStartedAt)
      if (newEvents.length === 0 && awLatestWindowEvent) {
        broadcastActivityWatchHeartbeat(buildHeartbeatEvent(awLatestWindowEvent, pollStartedAt))
      }
      return
    }

    awLastChecked = pollStartedAt
    if (awLatestWindowEvent) {
      broadcastActivityWatchHeartbeat(buildHeartbeatEvent(awLatestWindowEvent, pollStartedAt))
    }
  } catch (error) {
    console.error('[aw-poll] polling error:', error)
  } finally {
    awEventsPollInFlight = false
  }
}

async function startActivityWatchEventPolling(): Promise<void> {
  awLastChecked = new Date().toISOString()
  awWindowBucketId = await discoverWindowBucketId()

  if (awEventsPollTimer) {
    clearInterval(awEventsPollTimer)
  }

  awEventsPollTimer = setInterval(() => {
    void pollActivityWatchWindowEvents()
  }, ACTIVITYWATCH_EVENT_POLL_INTERVAL_MS)

  void pollActivityWatchWindowEvents()
}

async function startActivityWatch(): Promise<void> {
  const activityWatchRoot = resolveActivityWatchRoot()
  const awServerBinary = resolveBinaryPath(activityWatchRoot, 'aw-server', 'aw-server')
  const awWatcherWindowBinary = resolveBinaryPath(
    activityWatchRoot,
    'aw-watcher-window',
    'aw-watcher-window'
  )

  if (!(await isActivityWatchServerHealthy())) {
    if (!existsSync(awServerBinary)) {
      throw new Error(`ActivityWatch server binary not found at ${awServerBinary}`)
    }

    const awServerDir = dirname(awServerBinary)
    awServerProcess = attachProcessLogging(
      'aw-server',
      spawn(awServerBinary, [], {
        cwd: awServerDir,
        env: buildActivityWatchEnv(activityWatchRoot, awServerDir),
        stdio: 'pipe'
      })
    )

    await waitForActivityWatchServerReady()
  } else {
    console.log('[aw-server] already running, skipping launch')
  }

  if (!existsSync(awWatcherWindowBinary)) {
    throw new Error(`ActivityWatch watcher binary not found at ${awWatcherWindowBinary}`)
  }

  const awWatcherWindowDir = dirname(awWatcherWindowBinary)
  awWatcherWindowProcess = attachProcessLogging(
    'aw-watcher-window',
    spawn(awWatcherWindowBinary, [], {
      cwd: awWatcherWindowDir,
      env: buildActivityWatchEnv(activityWatchRoot, awWatcherWindowDir),
      stdio: 'pipe'
    })
  )

  await startActivityWatchEventPolling()
}

function startAnalyzerSidecar(): void {
  const pythonExecutable = resolveVenvPythonPath()
  if (!existsSync(pythonExecutable)) {
    throw new Error(`Venv Python binary not found at ${pythonExecutable}`)
  }

  if (!existsSync(SIDECAR_SCRIPT_PATH)) {
    throw new Error(`Analyzer sidecar script not found at ${SIDECAR_SCRIPT_PATH}`)
  }

  analyzerSidecarProcess = attachProcessLogging(
    'analyzer-sidecar',
    spawn(pythonExecutable, [SIDECAR_SCRIPT_PATH], {
      cwd: dirname(SIDECAR_SCRIPT_PATH),
      env: {
        ...process.env,
        PYTHONUNBUFFERED: '1',
        FOCUSLENS_ENV_PATH: ENV_FILE_PATH
      },
      stdio: 'pipe'
    })
  )
}

function stopActivityWatchProcesses(): void {
  if (awEventsPollTimer) {
    clearInterval(awEventsPollTimer)
    awEventsPollTimer = null
  }
  if (classificationDebounceTimer) {
    clearTimeout(classificationDebounceTimer)
    classificationDebounceTimer = null
  }

  for (const processToStop of [analyzerSidecarProcess, awWatcherWindowProcess, awServerProcess]) {
    if (processToStop && processToStop.exitCode === null && !processToStop.killed) {
      processToStop.kill('SIGTERM')
    }
  }
}

function createWindow(): void {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 900,
    height: 670,
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  // Set app user model id for windows
  electronApp.setAppUserModelId('com.electron')

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // IPC test
  ipcMain.on('ping', () => console.log('pong'))
  ipcMain.handle('activitywatch:get-latest-event', () => awLatestWindowEvent)
  ipcMain.handle('classification:get-latest', () => latestClassificationResult)
  ipcMain.handle('classification:get-history', () => classificationHistory)
  ipcMain.handle('goals:get', async () => getGoals())
  ipcMain.handle('goals:set', async (_event, goals: string[]) => setGoals(goals))

  startActivityWatch().catch((error) => {
    console.error('Failed to start ActivityWatch services:', error)
  })
  try {
    startAnalyzerSidecar()
  } catch (error) {
    console.error('Failed to start analyzer sidecar:', error)
  }

  createWindow()

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => {
  stopActivityWatchProcesses()
})

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
