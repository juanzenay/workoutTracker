# Workout tracker

A self-hosted, single-user lifting logger that plans lifting and running together.

This is a public starting point: copy it, deploy your own, then change anything you like. Your deployment and your data stay yours (your own Vercel and Supabase accounts); nothing here phones home.

## Run your own

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fjuanzenay%2FworkoutTracker&project-name=workout-tracker&repository-name=workout-tracker&env=OWNER_EMAIL%2CCRON_SECRET&envDescription=OWNER_EMAIL%3A%20the%20email%20you%20will%20claim%20light%20with.%20CRON_SECRET%3A%20any%20long%20random%20string%20%28e.g.%20openssl%20rand%20-hex%2032%29.&envLink=https%3A%2F%2Fgithub.com%2Fjuanzenay%2FworkoutTracker%2Fblob%2Fmain%2Fdocs%2Fsetup.md%231-deploy&stores=%5B%7B%22type%22%3A%22integration%22%2C%22protocol%22%3A%22storage%22%2C%22productSlug%22%3A%22supabase%22%2C%22integrationSlug%22%3A%22supabase%22%7D%5D)

The button copies this repository into your GitHub, creates a Vercel project with a Supabase
database (Vercel's Supabase integration sets the connection variables), applies the migrations
during the build, and asks for `OWNER_EMAIL` and `CRON_SECRET`. The first sign-up with
`OWNER_EMAIL` claims the deployment; every other account is refused.

Then follow **[docs/setup.md](docs/setup.md)**: Supabase Auth settings, importing your runs (Strava is optional),
the private backup repo, installing the app, push notifications, connecting your own Claude, and
what to do when a free Supabase project is paused.

## Brand new to this? Start here

You don't need to be a developer. Paste any of these into Claude, ChatGPT or Gemini and let it walk you through.

**Understand it**
> I found this GitHub project (*paste the link*): a self-hosted lifting and running tracker. I'm a complete beginner. Explain in plain English what it does, what accounts I need, what it costs, and whether it's worth setting up for me.

**Set it up with hand-holding**
> Walk me through docs/setup.md in this repo one step at a time. I've never used Vercel, Supabase or GitHub. Give me one step, wait for me to say "done", and tell me what I should see on screen. If something looks different, help me figure out why.

**Make it yours with a coding agent (Claude Code or Codex)**
> I deployed this app (workout tracker) and want to change it: *describe what you want, e.g. "kilos instead of pounds" or "rename the app and change the colors"*. I'm not a programmer. Tell me how to open the code in Claude Code or Codex, then make the change and explain what you changed. UI text lives in `src/strings/` and colors in `src/styles/tokens.css`.

**Want something simpler than a full app?**
> I like the idea of this lifting/running tracker but a full deployment sounds like too much. Can you build me a much simpler version as a single Claude artifact (a small web page that remembers my workouts)? Start with logging sets and showing my history, and ask me what I want to track.

> Compare three simpler ways to get a workout log and running plan: a spreadsheet, an existing app, or this self-hosted project. I'm non-technical. Recommend one and tell me why.

**Connect your own AI coach**
> I finished the setup guide and want my own Claude to act as my coach through the app's connector. Walk me through step 8 of docs/setup.md and suggest 5 things to ask it first.

**If something breaks**
> I'm setting up the workout tracker app (Next.js, Vercel, Supabase). Here's the step I was on and the error or screenshot: *paste it*. Explain what's wrong in plain English and the smallest fix.

## Development

Requires Node 22+ and a local PostgreSQL (16+) reachable at
`postgres://postgres:postgres@127.0.0.1:5432/postgres` (override with `TEST_DATABASE_URL`).

```sh
npm install
npm test          # command-layer tests against local Postgres (fresh database per test)
npm run typecheck
npm run lint
npm run check     # all three
npm run dev       # needs .env.local — see .env.example
```

- `src/server/commands/` — the command layer: every application operation (UI, MCP, webhooks, jobs go through it).
- `supabase/migrations/` — Supabase CLI migrations; `supabase/tests/bootstrap.sql` shims Supabase's auth schema and roles for plain Postgres.
  Production builds apply them (`npm run db:deploy`, run by `vercel-build`; see `src/server/deploy/`). Without a database URL a local build skips it; `SKIP_MIGRATIONS=1` always does.
- `src/strings/`, `src/styles/tokens.css` — all UI copy and design tokens (themes and Dumb Mode swap these, never layout).

## Credits

The base exercise catalogue is [free-exercise-db](https://github.com/yuhonas/free-exercise-db) (public domain), vendored in `vendor/free-exercise-db`.

Activity FIT files are read with [fit-file-parser](https://github.com/jimmykane/fit-parser) (MIT).
