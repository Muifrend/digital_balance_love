# Lessons

- Keep `CalendarView/index.tsx` as the single owner of renderer IPC and state; child calendar components should stay pure and receive data via props.
- For mixed live + aggregated timelines, separate raw realtime state from display state and flush display on a stable clock boundary to avoid jitter.
- Never use upstream event identifiers/timestamps directly as React list identity when synthetic heartbeats/rebroadcasts can repeat them; assign a local monotonic stream id.
- Heartbeat events must update timestamp at emission time, otherwise the UI appears frozen even when the active window is unchanged.
- For ActivityWatch window events, do not advance the polling `start` cursor on empty responses; events may be emitted later with older start timestamps and will be skipped.
- When user requests isolating a fix, first restore known-good stream behavior, then limit edits strictly to rendering/bucketing components.
- When user asks for a surgical code cut, make that exact cut first and then only apply required compile-fix cleanup (for example, removing newly unused variables).
- Keep event-id dedup strictly scoped to classification triggering; do not apply seen-id filtering to freshness paths (`awLatestWindowEvent` and broadcast updates).
- If the user asks for "no dedupe in render", remove state-level dedupe in every renderer consumer path (list + timeline), not just one component.
- When asked to improve readability, refactor complex logic into a small pipeline of pure helper functions while preserving behavior and scope.
- When two renderer components use near-identical bucketing/merging logic, extract shared pure helpers into a local `utils` module to avoid drift.
- For timeline UX, session-based grouping (continuity + gap rules + interruption absorption) is more reliable than strict minute slicing when user behavior includes quick app switches.
- If a bug report references minute-flush behavior, verify architecture first: calendars must consume minute-flushed display props, not raw live stream state from child-level IPC subscriptions.
- AW events can overlap in time; clamp computed gaps (`Math.max(0, gap)`) before continuity checks to avoid negative-gap artifacts in session merging.
