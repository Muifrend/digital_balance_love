# Task: Overlap-Based Minute Attribution for Activity Calendar

- [x] Verify existing bucketing behavior against requested rules
- [x] Implement per-minute overlap contribution winner selection (case-insensitive app grouping)
- [x] Ensure only completed minute buckets are rendered
- [x] Keep merging of consecutive same-app minute winners
- [x] Verify with web typecheck

## Review
- Verified gap: previous logic selected one event per event-start minute using duration tie-breaks; it did not compute overlap contributions across minute buckets.
- Implemented overlap-based attribution in `ActivityCalendar`:
  - parse each event into `startMs`/`endMs` (milliseconds)
  - iterate overlapping minute buckets and sum per-app contributions using `min(end,bucketEnd) - max(start,bucketStart)`
  - group app totals case-insensitively (`appKey = appName.toLowerCase()`)
  - select highest-contribution app as the minute winner (deterministic tie-breaks)
  - render winner as a full minute block
- Kept consecutive-minute merge behavior for same winning app.
- Removed active-minute rendering by limiting buckets to completed minutes only (`bucketEnd <= completedBoundaryMs`) and no longer extending the last event to `now`.
- Verified with `npm run typecheck:web` (passes).

# Task: Build Renderer Calendar Feature (Preload + CalendarView)

- [x] Add preload IPC methods for classification history, latest classification stream, and activity heartbeat stream
- [x] Add/align main-process IPC support for `classification:get-history` and heartbeat broadcasts used by renderer
- [x] Create `CalendarView` renderer types (`ActivityEvent`, `ClassificationEntry`)
- [x] Implement `CalendarView/index.tsx` as data owner for IPC calls/subscriptions and state upsert/append logic
- [x] Implement `ActivityList.tsx` (scrollable latest-first list)
- [x] Implement `ActivityCalendar.tsx` with overlap-based minute winner bucketing and merged app blocks
- [x] Implement `ClassificationCalendar.tsx` with 30-second attribution offset, minute carry-forward (15m), and merged on-goal/off-goal blocks
- [x] Replace `App.tsx` with `CalendarView`
- [x] Install renderer dependencies (`moment`, `@types/react-big-calendar`)
- [x] Verify with `npm run typecheck`

## Review
- Added new preload API methods:
  - `getClassificationHistory()` (`classification:get-history`)
  - `onLatestClassification()` (`classification:latest`)
  - `onActivityWatchHeartbeat()` (`activitywatch:heartbeat`)
- Extended main process stream surface so renderer subscriptions are functional:
  - classification entries now include `timestamp`, `app`, and `title`
  - in-memory `classificationHistory` is exposed via `classification:get-history`
  - heartbeat broadcasts emit on `activitywatch:heartbeat` when no new AW event arrives
- Built `CalendarView` as the only IPC touchpoint; child components are pure prop consumers.
- Activity calendar uses per-minute overlap contribution winner selection and merges consecutive same-app minute blocks.
- Classification calendar attributes each classification to trigger minute (`-30s`), keeps latest classification per minute, carries forward for up to 15 minutes, and merges same-state consecutive minutes.
- Validation: `npm run typecheck` passes.
