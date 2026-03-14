import { ReactElement, useMemo } from 'react'
import DayCalendar, { type DayCalendarEvent } from './DayCalendar'
import type { ActivityEvent } from './types'
import { appToColor } from './utils/colors'
import { buildActivityMinuteBlocks } from './utils/activityTimeline'

interface ActivityCalendarProps {
  events: ActivityEvent[]
}

function toCalendarEvent(block: { startMs: number; endMs: number; app: string }): DayCalendarEvent {
  return {
    start: new Date(block.startMs),
    end: new Date(block.endMs),
    title: block.app,
    resource: {
      color: appToColor(block.app)
    }
  }
}

function getLatestEventEndMs(events: ActivityEvent[]): number {
  let latestEndMs = 0

  for (const event of events) {
    const startMs = Date.parse(event.timestamp)
    if (Number.isNaN(startMs)) continue

    const endMs = startMs + Math.max(0, event.duration) * 1000
    if (endMs > latestEndMs) latestEndMs = endMs
  }

  return latestEndMs
}

export default function ActivityCalendar({ events }: ActivityCalendarProps): ReactElement {
  const calendarEvents = useMemo(() => {
    const nowMs = getLatestEventEndMs(events)
    return buildActivityMinuteBlocks(events, nowMs).map(toCalendarEvent)
  }, [events])

  return <DayCalendar title="Activity Calendar" events={calendarEvents} />
}
