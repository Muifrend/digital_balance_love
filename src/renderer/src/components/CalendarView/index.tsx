import { useEffect, useState, type Dispatch, type JSX, type SetStateAction } from 'react'
import ActivityCalendar from './ActivityCalendar'
import ActivityList from './ActivityList'
import ClassificationCalendar from './ClassificationCalendar'
import type { ActivityEvent, ClassificationEntry } from './types'
import {
  normalizeActivityEvent,
  normalizeClassificationEntry,
  upsertActivityEvent
} from './utils/streamState'

interface SeedState {
  latestEvent: ActivityWatchEvent | null
  history: ClassificationEntry[]
  loadedGoals: string[]
}

function applySeedState(
  seed: SeedState,
  setRawEvents: Dispatch<SetStateAction<ActivityEvent[]>>,
  setRawClassifications: Dispatch<SetStateAction<ClassificationEntry[]>>,
  setGoals: Dispatch<SetStateAction<string[]>>,
  setGoalInput: Dispatch<SetStateAction<string>>
): void {
  const normalizedEvent = normalizeActivityEvent(seed.latestEvent)
  if (normalizedEvent) setRawEvents([normalizedEvent])

  const normalizedHistory = seed.history
    .map((entry) => normalizeClassificationEntry(entry))
    .filter((entry): entry is ClassificationEntry => entry !== null)
  setRawClassifications(normalizedHistory)

  setGoals(seed.loadedGoals)
  setGoalInput(seed.loadedGoals[0] ?? '')
}

function subscribeToEvents(
  setRawEvents: Dispatch<SetStateAction<ActivityEvent[]>>,
  setRawClassifications: Dispatch<SetStateAction<ClassificationEntry[]>>
): Array<() => void> {
  const onIncomingEvent = (event: ActivityWatchEvent): void => {
    const normalizedEvent = normalizeActivityEvent(event)
    if (!normalizedEvent) return
    setRawEvents((previous) => upsertActivityEvent(previous, normalizedEvent))
  }

  const unsubscribeLatestEvent = window.api.onLatestActivityWatchEvent(onIncomingEvent)
  const unsubscribeHeartbeat = window.api.onActivityWatchHeartbeat(onIncomingEvent)
  const unsubscribeLatestClassification = window.api.onLatestClassification((entry) => {
    const normalizedEntry = normalizeClassificationEntry(entry)
    if (!normalizedEntry) return
    setRawClassifications((previous) => [...previous, normalizedEntry])
  })

  return [unsubscribeLatestEvent, unsubscribeHeartbeat, unsubscribeLatestClassification]
}

export default function CalendarView(): JSX.Element {
  const [rawEvents, setRawEvents] = useState<ActivityEvent[]>([])
  const [rawClassifications, setRawClassifications] = useState<ClassificationEntry[]>([])
  const [goals, setGoals] = useState<string[]>([])
  const [goalInput, setGoalInput] = useState('')
  const [saveMessage, setSaveMessage] = useState('')

  useEffect(() => {
    let isMounted = true

    void Promise.all([
      window.api.getLatestActivityWatchEvent(),
      window.api.getClassificationHistory(),
      window.api.getGoals()
    ]).then(([latestEvent, history, loadedGoals]) => {
      if (!isMounted) return
      applySeedState(
        { latestEvent, history, loadedGoals },
        setRawEvents,
        setRawClassifications,
        setGoals,
        setGoalInput
      )
    })

    const unsubscribers = subscribeToEvents(setRawEvents, setRawClassifications)

    return () => {
      isMounted = false
      for (const unsubscribe of unsubscribers) unsubscribe()
    }
  }, [])

  const handleSaveGoal = async (): Promise<void> => {
    const nextGoals = goalInput.trim() ? [goalInput.trim()] : []
    const savedGoals = await window.api.setGoals(nextGoals)
    setGoals(savedGoals)
    setGoalInput(savedGoals[0] ?? '')
    setSaveMessage('Saved.')
  }

  const handleGoalInputChange = (value: string): void => {
    setGoalInput(value)
    if (saveMessage) setSaveMessage('')
  }

  return (
    <div className="flex h-screen flex-col bg-slate-50 text-slate-900">
      <header className="border-b border-slate-200 bg-white px-4 py-3">
        <div className="mb-2 flex items-center justify-between gap-4">
          <h1 className="text-lg font-semibold">FocusLens</h1>
          <p className="text-sm text-slate-600">Current goal: {goals[0] ?? 'None set'}</p>
        </div>

        <div className="flex items-center gap-2">
          <input
            type="text"
            value={goalInput}
            onChange={(event) => handleGoalInputChange(event.target.value)}
            placeholder="Enter your weekly goal"
            className="w-full max-w-xl rounded border border-slate-300 px-3 py-2 text-sm"
          />
          <button
            type="button"
            onClick={() => void handleSaveGoal()}
            className="rounded bg-slate-900 px-3 py-2 text-sm font-medium text-white"
          >
            Save Goal
          </button>
          {saveMessage && <p className="text-xs text-emerald-600">{saveMessage}</p>}
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="w-[280px] border-r border-slate-200 bg-white">
          <ActivityList events={rawEvents} />
        </aside>

        <section className="min-w-0 flex-1 border-r border-slate-200 bg-white">
          <ActivityCalendar events={rawEvents} />
        </section>

        <section className="min-w-0 flex-1 bg-white">
          <ClassificationCalendar classifications={rawClassifications} />
        </section>
      </div>
    </div>
  )
}
