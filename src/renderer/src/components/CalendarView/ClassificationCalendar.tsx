import { useMemo } from 'react'
import DayCalendar, { type DayCalendarEvent } from './DayCalendar'
import type { ClassificationEntry } from './types'
import { buildClassificationMinuteBlocks } from './utils/classificationTimeline'
import { classificationToColor } from './utils/colors'

interface ClassificationCalendarProps {
  classifications: ClassificationEntry[]
}

function toCalendarEvent(block: { startMs: number; endMs: number; onGoal: boolean }): DayCalendarEvent {
  return {
    start: new Date(block.startMs),
    end: new Date(block.endMs),
    title: block.onGoal ? 'On Goal' : 'Distracted',
    resource: {
      color: classificationToColor(block.onGoal)
    }
  }
}

export default function ClassificationCalendar({ classifications }: ClassificationCalendarProps) {
  const calendarEvents = useMemo(() => {
    return buildClassificationMinuteBlocks(classifications, Date.now()).map(toCalendarEvent)
  }, [classifications])

  return <DayCalendar title="Classification Calendar" events={calendarEvents} />
}
