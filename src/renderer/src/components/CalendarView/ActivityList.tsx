import { ReactElement, useMemo } from 'react'
import type { ActivityEvent } from './types'

interface ActivityListProps {
  events: ActivityEvent[]
}

function formatTimestamp(timestamp: string): string {
  const parsed = new Date(timestamp)
  if (Number.isNaN(parsed.getTime())) return timestamp

  return parsed.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  })
}

export default function ActivityList({ events }: ActivityListProps): ReactElement {
  const sortedEvents = useMemo(() => {
    return [...events].sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp))
  }, [events])

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-slate-200 px-3 py-2">
        <h2 className="text-sm font-semibold text-slate-800">Activity Stream</h2>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {sortedEvents.length === 0 ? (
          <p className="px-3 py-4 text-sm text-slate-500">No activity yet.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {sortedEvents.map((event) => (
              <li key={event.id} className="px-3 py-2">
                <p className="text-sm font-semibold text-slate-900">{event.data.app || 'Unknown'}</p>
                <p className="truncate text-xs text-slate-600" title={event.data.title}>
                  {event.data.title || 'No window title'}
                </p>
                <p className="mt-1 text-[11px] text-slate-500">{formatTimestamp(event.timestamp)}</p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
