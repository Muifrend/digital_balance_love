# FocusLens

## Key Architecture
```
Electron Main (src/main/index.ts)
  → spawns aw-server (localhost:5600)
  → spawns aw-watcher-window
  → spawns backend/sidecar/analyzer.py (localhost:5001)
  → polls AW API every 2s with timestamp + ID deduplication
  → 30s debounce on new events → POST /classify to sidecar
  → maintains in-memory classification history (capped at 500)
  → handles IPC from renderer

Preload (src/preload/index.ts)
  → contextBridge exposes safe APIs to renderer



Python Sidecar (backend/sidecar/analyzer.py)
  → HTTP server on localhost:5001
  → POST /classify — receives { app, title, goal }, calls OpenAI gpt-4o-mini
  → returns { onGoal: boolean, confidence: number, reasoning: string }
  → POST /screenshot — stub, returns { status: "not implemented" }
  → reads OPENAI_API_KEY from .env via FOCUSLENS_ENV_PATH env var
```

## Key Files
- `src/main/index.ts` — spawns AW + sidecar, polling loop, debounce, classification, IPC handlers
- `src/preload/index.ts` — exposes getGoals, setGoals, getLatestActivityWatchEvent, onLatestActivityWatchEvent, getLatestClassification, onLatestClassification, getClassificationHistory, clearClassificationHistory
- `backend/sidecar/analyzer.py` — OpenAI classification endpoint, SO_REUSEADDR set
- `backend/goals.json` — stores current weekly goal (single goal for now)
- `resources/activitywatch/` — prebuilt AW binaries per platform
- `src/renderer/src/components/CalendarView/index.tsx` — owns all IPC, passes data to children
- `src/renderer/src/components/CalendarView/ActivityList.tsx` — left panel, raw events + badges
- `src/renderer/src/components/CalendarView/ActivityCalendar.tsx` — 1-min bucketed calendar
- `src/renderer/src/components/CalendarView/ClassificationCalendar.tsx` — AI calendar (stub)
- `src/renderer/src/components/CalendarView/types.ts` — shared ActivityEvent, ClassificationEntry types

## IPC Channels
```
goals:get                    → string[]
goals:set                    → string[]
activitywatch:latest-event   → broadcast ActivityEvent
activitywatch:get-latest-event → ActivityEvent | null
classification:latest        → broadcast ClassificationEntry
classification:get-latest    → ClassificationEntry | null
classification:get-history   → ClassificationEntry[]
classification:clear-history → void
```

## ActivityWatch API (localhost:5600)
```
GET  /api/0/buckets/                          # list all buckets
GET  /api/0/buckets/{id}/events               # get events from watcher
POST /api/0/query/                            # query across buckets
GET  /api/0/info                              # server info / health check
```
Window events come from bucket: `aw-watcher-window_{hostname}`
Each event: `{ id: number, timestamp: string, duration: number, data: { app: string, title: string } }`

## Polling & Classification Flow
```
every 2s → GET /events?start={awLastChecked}
  → filter by seenEventIds (Set<number>) for deduplication
  → update awLastChecked
  → on new event → scheduleDebouncedClassification(event)
      → cancel existing timer
      → after 30s → classifyEventWithCurrentGoal(event)
          → read goal from goals.json
          → POST localhost:5001/classify
          → append to classificationHistory[]
          → broadcast classification:latest
```

## Core Features
- **Single Weekly Goal** — user defines one goal stored in `backend/goals.json`
- **2s Polling + ID Dedup** — only genuine new window switches propagate
- **30s Debounce** — classification only fires after user settles in a window
- **AI Classification** — OpenAI gpt-4o-mini, metadata only (no screenshots yet)
- **Two Calendar View** — activity calendar (1-min bucketed, app colors) + AI calendar (stub)
- **Activity List** — left panel showing raw events with on-goal/distracted/unclassified badges
- **AI Toggle** — planned, not yet implemented
- **Screenshot fallback** — planned, not yet implemented
- **SQLite persistence** — planned, not yet implemented

## Platform Notes
- Primary target: macOS
- Linux dev environment: Ubuntu on Xorg (not Wayland — pynput/Xlib incompatibility)
- aw-watcher-afk skipped (Wayland incompatibility), AFK detection planned via GNOME idle monitor
- AW binaries in resources/ are platform-specific, not committed to git

## Dev Setup
```bash
# Python
python -m venv .venv
source .venv/bin/activate
pip install aw-server aw-watcher-window openai python-dotenv

# Node
npm install

# Environment
cp .env.example .env
# add OPENAI_API_KEY=sk-... to .env

# AW binaries (download from github.com/ActivityWatch/activitywatch/releases)
# unzip into resources/activitywatch/{platform}/
# chmod +x on mac/linux
```

---


## Workflow Orchestration
### 1. Plan Node Default
- Enter plan mode for ANY non-trivial task (3+ steps or architectural decisions)
- If something goes sideways, STOP and re-plan immediately – don't keep pushing
- Use plan mode for verification steps, not just building
- Write detailed specs upfront to reduce ambiguity

### 2. Subagent Strategy
- Use subagents liberally to keep main context window clean
- Offload research, exploration, and parallel analysis to subagents
- For complex problems, throw more compute at it via subagents
- One tack per subagent for focused execution

### 3. Self-Improvement Loop
- After ANY correction from the user: update `tasks/lessons.md` with the pattern
- Write rules for yourself that prevent the same mistake
- Ruthlessly iterate on these lessons until mistake rate drops
- Review lessons at session start for relevant project

### 4. Verification Before Done
- Never mark a task complete without proving it works
- Diff behavior between main and your changes when relevant
- Ask yourself: "Would a staff engineer approve this?"
- Run tests, check logs, demonstrate correctness

### 5. Demand Elegance (Balanced)
- For non-trivial changes: pause and ask "is there a more elegant way?"
- If a fix feels hacky: "Knowing everything I know now, implement the elegant solution"
- Skip this for simple, obvious fixes – don't over-engineer
- Challenge your own work before presenting it

### 6. Autonomous Bug Fixing
- When given a bug report: just fix it. Don't ask for hand-holding
- Point at logs, errors, failing tests – then resolve them
- Zero context switching required from the user
- Go fix failing CI tests without being told how

## Task Management
1. **Plan First**: Write plan to `tasks/todo.md` with checkable items
2. **Verify Plan**: Check in before starting implementation
3. **Track Progress**: Mark items complete as you go
4. **Explain Changes**: High-level summary at each step
5. **Document Results**: Add review section to `tasks/todo.md`
6. **Capture Lessons**: Update `tasks/lessons.md` after corrections

## Core Principles
- **Simplicity First**: Make every change as simple as possible. Impact minimal code.
- **No Laziness**: Find root causes. No temporary fixes. Senior developer standards.
- **Minimal Impact**: Changes should only touch what's necessary. Avoid introducing bugs.