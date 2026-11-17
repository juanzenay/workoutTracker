# Glossary

Terms as this codebase uses them. Check `src/domain/` for the exact shapes.

- **Block**: a multi-week training plan that schedules lifting and running together (`src/domain/block.ts`). Edited in the block editor; changes are recorded as plan revisions.
- **Plan change / plan revision**: a recorded change to a block's plan (a re-plan, a move, an injury adjustment) that the user can review (`plan-change.ts`, `commands/plan-revisions.ts`).
- **Re-plan**: the daily job and the injury tracker adjusting upcoming sessions, e.g. moving or dropping missed sessions and long runs (`commands/replan.ts`).
- **Routine**: a reusable list of exercises with targets, used to start a workout (`routine.ts`).
- **Workout**: one logged session. Logged locally first and synced through an outbox of ops (`src/client/workout-store.ts`, `/api/workouts/sync`).
- **Machine / Gym**: machines belong to a gym; weights and notes (seat, pad positions) are tracked per machine under each exercise.
- **Catalogue**: the built-in exercise list (free-exercise-db) plus custom exercises and Wger results.
- **Heatmap**: weekly sets per muscle against a 15-set target, using the merged muscle groups in `muscle-map.ts`.
- **Injury**: an open injury that makes the planner work around affected muscles (`injury.ts`).
- **Availability / Unavailable**: days the user can't train; planning respects them.
- **Command layer**: every application operation lives in `src/server/commands/`; the UI, MCP tools, webhooks and cron jobs all go through it.
- **Actor**: who is calling a command: the signed-in `user` or the `service` (cron, webhooks).
- **Inbox**: items the app raises for the owner, e.g. a failed backup.
- **Dumb Mode**: a string skin (`src/strings/dumb.ts`) that swaps copy only, never layout.
- **Skin / string pack**: a set of UI copy; all user-facing text comes from `src/strings/`.
