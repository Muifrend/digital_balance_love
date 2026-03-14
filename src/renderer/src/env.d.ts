/// <reference types="vite/client" />

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

interface ClassificationEntry {
  timestamp: string
  app: string
  title: string
  onGoal: boolean
  confidence: number
  reasoning: string
}

interface RendererApi {
  getLatestActivityWatchEvent: () => Promise<ActivityWatchEvent | null>
  getClassificationHistory: () => Promise<ClassificationEntry[]>
  getGoals: () => Promise<string[]>
  setGoals: (goals: string[]) => Promise<string[]>
  onLatestActivityWatchEvent: (callback: (event: ActivityWatchEvent) => void) => () => void
  onActivityWatchHeartbeat: (callback: (event: ActivityWatchEvent) => void) => () => void
  onLatestClassification: (callback: (entry: ClassificationEntry) => void) => () => void
}

interface Window {
  api: RendererApi
}
