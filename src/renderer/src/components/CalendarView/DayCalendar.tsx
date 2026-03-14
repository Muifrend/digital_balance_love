import moment from 'moment'
import { Calendar, momentLocalizer, type Event as BigCalendarEvent } from 'react-big-calendar'
import 'react-big-calendar/lib/css/react-big-calendar.css'
import type { CSSProperties, ReactElement } from 'react'
import { MINUTE_MS } from './utils/constants.ts'

const localizer = momentLocalizer(moment)
const INITIAL_CALENDAR_DATE = new Date()
const INITIAL_SCROLL_TIME = new Date(INITIAL_CALENDAR_DATE.getTime() - 30 * MINUTE_MS)

interface CalendarResource {
  color: string
}

export interface DayCalendarEvent extends BigCalendarEvent {
  start: Date
  end: Date
  title: string
  resource: CalendarResource
}

interface DayCalendarProps {
  title: string
  events: DayCalendarEvent[]
}

function getEventStyle(event: DayCalendarEvent): CSSProperties {
  return {
    backgroundColor: event.resource.color,
    borderColor: event.resource.color,
    borderRadius: '4px',
    color: '#ffffff',
    fontSize: '12px'
  }
}

export default function DayCalendar({ title, events }: DayCalendarProps): ReactElement {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-slate-200 px-3 py-2">
        <h2 className="text-sm font-semibold text-slate-800">{title}</h2>
      </div>

      <div className="min-h-0 flex-1 [&_.rbc-time-slot]:min-h-[12px]">
        <Calendar<DayCalendarEvent>
          localizer={localizer}
          events={events}
          defaultView="day"
          views={['day']}
          toolbar={false}
          step={1}
          timeslots={1}
          defaultDate={INITIAL_CALENDAR_DATE}
          scrollToTime={INITIAL_SCROLL_TIME}
          startAccessor="start"
          endAccessor="end"
          eventPropGetter={(event) => ({
            style: getEventStyle(event)
          })}
        />
      </div>
    </div>
  )
}
