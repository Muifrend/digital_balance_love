import type { ActivityEvent, ClassificationEntry } from '../types'

function readString(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback
}

function readNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' ? value : fallback
}

export function normalizeActivityEvent(event: ActivityWatchEvent | null): ActivityEvent | null {
  if (!event || typeof event.id !== 'number') return null
  if (typeof event.timestamp !== 'string' || !event.timestamp) return null

  return {
    id: event.id,
    timestamp: event.timestamp,
    duration: readNumber(event.duration, 0),
    data: {
      app: readString(event.data?.app, 'Unknown'),
      title: readString(event.data?.title, '')
    }
  }
}

export function normalizeClassificationEntry(
  entry: Partial<ClassificationEntry>
): ClassificationEntry | null {
  if (!entry || typeof entry.timestamp !== 'string') return null

  return {
    timestamp: entry.timestamp,
    app: readString(entry.app, 'Unknown'),
    title: readString(entry.title, ''),
    onGoal: Boolean(entry.onGoal),
    confidence: readNumber(entry.confidence, 0),
    reasoning: readString(entry.reasoning, '')
  }
}

export function upsertActivityEvent(events: ActivityEvent[], incoming: ActivityEvent): ActivityEvent[] {
  const index = events.findIndex((event) => event.id === incoming.id)
  if (index < 0) return [...events, incoming]

  const updated = [...events]
  updated[index] = incoming
  return updated
}
