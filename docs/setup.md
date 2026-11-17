# Set up your own workout tracker

This guide takes you from nothing to your own workout tracker, with your runs imported from your watch's
app (or, optionally, flowing in from Strava), a nightly
backup, notifications on your phone, and your own Claude as your coach. Plan on about 15 minutes,
plus a few minutes waiting for builds.

Workout tracker is single-user: your deployment holds only your data, in your own Supabase project, and
locks itself to your account the moment you claim it. Nobody else (including whoever wrote this
guide) can see it.

Each step says **where** you are (which website), **what** to click or type, and **how to know it
worked**. Steps marked *optional* can be skipped and done later.

## What you need

- A **GitHub** account (the Deploy button copies the code into it).
- A **Vercel** account (free Hobby plan is fine). Sign up with GitHub at <https://vercel.com/signup>.
- Your watch's app (e.g. Coros) to export your runs as files. A **Strava** API app is optional (it
  needs a paid Strava subscription).
- A **Claude** account that can add custom connectors (Settings → Connectors), if you want the coach.
- Your phone, to install the app.

Keep a scratch note open: you will copy a few values (your app's URL, some keys) between sites.

---

## 1. Deploy

**Where:** this repository's README.

1. Click **Deploy with Vercel**.
2. Vercel asks you to sign in, then to **create a Git repository**. Pick your GitHub account, keep
   the name `Workout Tracker`, and choose **Private** if you like. This is your copy of the code.
3. Vercel asks you to **add Supabase**. Click **Add**, accept the Supabase terms, and create a new
   project:
   - Plan: **Free** is enough.
   - Region: the one closest to you.
   - Leave the environment-variable prefix empty.

   This creates your database and sets its connection details on your Vercel project for you.
4. Vercel asks for two **environment variables**:
   - `OWNER_EMAIL`: the email you will sign in to workout tracker with. Only this email can claim the
     deployment.
   - `CRON_SECRET`: any long random string. To make one, run `openssl rand -hex 32` in a terminal,
     or mash the keyboard for 40+ characters. You never need to type it again.
5. Click **Deploy** and wait for the build (2–4 minutes).

**It worked when:** Vercel shows "Congratulations" and a preview of your app. Write down your app's
URL (for example `https://workout-tracker-yourname.vercel.app`) in your scratch note; this guide calls it
**`<your-app>`**.

> The build applies the database migrations itself. In the build log (Vercel → your project →
> Deployments → the latest one → **Building**) you'll see `Workout tracker: applied migrations …`. Every
> later deploy applies only new ones, and `Workout tracker: database is up to date.` when there are none.

**If the build failed** with `No database connection string`: the Supabase step was skipped. In
Vercel, open your project → **Storage** → **Connect Database** → Supabase → create or pick a
project → **Connect**, then **Deployments** → latest → ⋯ → **Redeploy**.

## 2. Point Supabase Auth at your app

**Where:** Supabase dashboard. From Vercel: your project → **Storage** → your Supabase database →
**Open in Supabase**.

1. **Authentication → URL Configuration**
   - **Site URL**: `<your-app>` (for example `https://workout-tracker-yourname.vercel.app`).
   - **Redirect URLs** → **Add URL**: `<your-app>/**` → Save.

   This is where your claim-confirmation email sends you back to.
2. **Authentication → OAuth Server** (needed for the Claude coach in step 8):
   - Turn on **Enable the Supabase OAuth Server**.
   - **Authorization Path**: `/oauth/consent`
   - Turn on **Allow Dynamic OAuth Apps**.
   - Save.
3. **Project Settings → JWT Keys**: the **current key** must be an asymmetric key (type
   **ECC (P-256)** or **RSA**), not "Legacy HS256 (shared secret)". New projects already have
   one. If yours shows the legacy secret: click **Migrate JWT secret**, then **Rotate keys**, and
   confirm.

**It worked when:** the Site URL shows your app's address and the OAuth Server page says enabled.

## 3. Claim your workout tracker

**Where:** `<your-app>` in your browser.

1. Open `<your-app>`. Because nobody owns it yet, you see **Claim this workout tracker**.
2. Enter the email you set as `OWNER_EMAIL`, choose a password (8+ characters), click **Claim it**.
3. Open the confirmation email from Supabase and click the link. You land in workout tracker, signed in.

From now on that account is the owner. Any other sign-up is refused by the database itself, and
the page shows a normal sign-in form.

**It worked when:** you see Today with the navigation bar.

**If it says "can't be claimed with that email":** you typed a different email from `OWNER_EMAIL`.
Check the value in Vercel → Settings → Environment Variables.

**If the email never arrives:** Supabase's built-in mailer sends only a few emails per hour. Wait a
few minutes and check spam. Then go back to `<your-app>` (it now shows a sign-in form) and sign
in with your email and password: workout tracker notices the email isn't confirmed and sends a new link.

**If someone else's account got there first**, or you want to start over: Supabase →
**Authentication → Users** → ⋯ next to the account → **Delete user**. The deployment is unclaimed
again (its data stays), and `<your-app>` shows the claim form.

*Optional hardening:* Supabase → **Authentication → Sign In / Providers** → turn off **Allow new
users to sign up**. Workout tracker already refuses every other account, so this only stops strangers from
getting a "refused" error instead of a "sign-ups disabled" one.

## 4. Your runs: import them from Coros

Workout tracker marks each planned run done, partial or missed from the runs you actually did, and re-plans
around them. You give it those runs as activity files exported from your watch's app. No account
or setup is needed: this works on every deployment.

**Where:** the Coros app on your phone.

1. Open **Profile** (or **Activities**) and tap the run.
2. Tap the share (or **⋯**) button, choose **Export Data**, and pick **FIT** (GPX works too).
3. Save the file to your phone (Files, or share it to yourself). Repeat for each run; export
   several before uploading if you like.

**Where:** workout tracker → **Today** → **Import run**. On a training day, open the session card first; on a
rest day it's on the card itself. Also under **Races** → **Completed runs**, or `<your-app>/runs`.

4. Tap **Activity files**, pick one or more `.fit`, `.gpx` or `.tcx` files, and tap **Import**.

**It worked when:** each file shows "Run on *day*, *distance* — imported" and the run appears under
**Recent activities**, marked "Counted toward the plan" when it matched a planned run.

Good to know:

- Importing the same run again, or an export that overlaps an earlier one, never counts a run twice.
- Rides, walks and other sports are skipped with a note; a damaged file says so and the rest of the
  upload still imports.
- Runs arrive late with file imports, so a planned run with nothing imported is only marked
  **missed** once you import a run from a later day. Importing a few days late is fine.
- FIT files carry the watch's local time; GPX and TCX runs are placed on a day using your plan's
  time zone.

## 4b. Strava (optional)

You can skip this step: Strava is optional. Strava now requires a paid subscription for anyone who
owns an API app, and its API terms restrict AI use and long-term storage of its data. Without the
Strava variables below, workout tracker never mentions Strava and nothing Strava-related runs; import your
runs from files (step 4) instead.

If you do have Strava and want runs to flow in automatically (and finished lifting workouts posted
there), workout tracker talks to Strava through an API app that belongs to you. A personal app works for one
athlete (you) without Strava reviewing it.

**Where:** <https://www.strava.com/settings/api>, signed in to Strava.

1. Fill in **My API Application**:
   - **Application Name**: `Workout Tracker` (anything works).
   - **Category**: Training.
   - **Website**: `<your-app>`
   - **Authorization Callback Domain**: your app's host only, without `https://` or a path. For
     example `workout-tracker-yourname.vercel.app`.
   - Upload any icon if asked. Agree and **Create**.
2. Copy the **Client ID** and **Client Secret** (click **show**) into your scratch note.

**Where:** Vercel → your project → **Settings → Environment Variables**. Add, for Production:

| Name | Value |
| --- | --- |
| `STRAVA_CLIENT_ID` | the Client ID |
| `STRAVA_CLIENT_SECRET` | the Client Secret |
| `STRAVA_WEBHOOK_VERIFY_TOKEN` | any random string (e.g. `openssl rand -hex 16`) |

Then **Deployments** → latest → ⋯ → **Redeploy** (environment variables only reach new deploys).

**Where:** workout tracker → **Races** → **Strava** (or `<your-app>/strava`).

3. Click **Connect Strava**, then **Authorize** on Strava's page. Keep every box ticked: workout tracker
   needs to read your activities (including private ones) and post finished lifting workouts.
4. Back in workout tracker, under the webhook section, click **Subscribe**. This tells Strava to notify
   workout tracker whenever an activity is created or changed.

**It worked when:** the Strava page says "Connected as *your name*" and the webhook is subscribed.
Your next run that syncs to Strava (for example from a Coros watch) appears there within a minute.

## 5. Private backup repo

The free Supabase tier has no backups you can download, so workout tracker commits all your data to a
private GitHub repository every night.

**Where:** GitHub.

1. Create a **private** repository: <https://github.com/new> → name `workout-tracker-backup` → **Private** →
   tick **Add a README** (so it has a branch) → **Create repository**.
2. Create a token that can write only to that repo:
   <https://github.com/settings/personal-access-tokens/new>
   - **Token name**: `Workout tracker backup`. **Expiration**: the longest you're comfortable with (put a
     reminder in your calendar to renew it).
   - **Repository access**: **Only select repositories** → `workout-tracker-backup`.
   - **Permissions → Repository permissions → Contents**: **Read and write**.
   - **Generate token** and copy it (starts with `github_pat_`).

**Where:** Vercel → **Settings → Environment Variables**. Add:

| Name | Value |
| --- | --- |
| `BACKUP_GITHUB_REPO` | `your-github-name/workout-tracker-backup` |
| `BACKUP_GITHUB_TOKEN` | the token |

Redeploy (Deployments → ⋯ → **Redeploy**).

**It worked when:** the next morning, `workout-tracker-backup` has a commit "Nightly backup …". Workout tracker's
**Export** page shows the last backup run. If a backup fails, workout tracker puts an important item in your
inbox (and a push notification, after step 6).

> Without a backup repo, workout tracker falls back to a private `backups` bucket in your Supabase Storage,
> which disappears with the project. Set up the repo.

## 6. Install the app and turn on notifications

### 6a. Push keys (once, on your computer)

**Where:** a terminal with Node installed (any computer).

```sh
npx web-push generate-vapid-keys
```

It prints a **Public Key** and a **Private Key**.

**Where:** Vercel → **Settings → Environment Variables**. Add:

| Name | Value |
| --- | --- |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | the Public Key |
| `VAPID_PRIVATE_KEY` | the Private Key |
| `VAPID_SUBJECT` | `mailto:` + your email, e.g. `mailto:you@example.com` |

Redeploy.

### 6b. Install workout tracker on your phone

- **iPhone (iOS 16.4 or later)**: open `<your-app>` in **Safari** → sign in → **Share** button →
  **Add to Home Screen** → **Add**. Notifications only work from the Home Screen app, not from a
  Safari tab.
- **Android**: open `<your-app>` in **Chrome** → sign in → ⋮ menu → **Install app** (or **Add to
  Home screen**) → **Install**.

Open workout tracker from the new icon. It opens full screen, and works offline in the gym once it has
loaded once.

### 6c. Turn on notifications

In the installed app: **Inbox** → **Enable notifications** → **Allow** when your phone asks.
Do this on every device you want notified.

**It worked when:** the Inbox says "Notifications are on for this device." workout tracker only notifies you
when something needs you: plan changes waiting for your confirmation, and backup failures.

## 7. Import from Hevy (optional)

If you are coming from Hevy (needs Hevy Pro for the API key): copy your API key from Hevy →
**Settings → Developer**, then workout tracker → **Import** → paste it → **Import now**. Re-run it as often
as you like until you switch over; it never duplicates.

## 8. Connect your own Claude as your coach

**Where:** Claude (claude.ai or the Claude app), signed in to your account.

1. **Settings → Connectors → Add custom connector**.
2. **Name**: `Workout Tracker`. **Remote MCP server URL**: `<your-app>/api/mcp`. **Add**.
3. Click **Connect** next to workout tracker. Claude opens your workout tracker's **Connect your coach** page (sign in
   if asked, with your owner account). Read what it can do, then click **Allow**.
4. In a new chat, enable the workout tracker connector (the tools menu) and ask: *"What's on my calendar
   this week?"*

**It worked when:** Claude answers with your week from workout tracker. Coach changes (marking days
unavailable, importing a run plan, adding races) only apply when you approve them in chat, and
every one can be undone in workout tracker.

*Coros:* to send planned runs to a Coros watch, also add the Coros connector in Claude and ask
the coach to "push this week's runs to my watch".

**If Connect fails** with an error page from Supabase: recheck step 2.2 (OAuth Server enabled,
path `/oauth/consent`, dynamic apps allowed) and step 2.3 (asymmetric JWT key).

## 9. If your Supabase project gets paused

Free Supabase projects pause after about a week with too little database activity. Workout tracker's daily
job and nightly backup usually keep it awake, but a long break (or a failing cron) can
still let it pause. Supabase emails you a warning first, then again when it pauses.

**Symptoms:** workout tracker won't load or shows errors; the backup stops; Supabase sent "project paused".

**Fix (within 90 days of the pause):**

1. Open <https://supabase.com/dashboard> (from Vercel: your project → **Storage** → your database
   → **Open in Supabase**).
2. Pick your organization, then the paused project.
3. Click **Resume project** (shown as **Restore project** on some screens) and confirm.
4. Wait a few minutes until the project shows as healthy. Your data and settings come back as they
   were. Open workout tracker and sign in.

After 90 days a paused project can no longer be resumed from the dashboard. That is what the
nightly GitHub backup is for: `workout-tracker-backup.json` in your backup repo holds all your data (the
same JSON as workout tracker's Export page). Workout tracker has no one-click restore from it yet, so don't let a
paused project sit for months: resume it as soon as Supabase emails you.

To never be paused, upgrade the Supabase organization to the Pro plan.

## 10. Keeping your copy up to date

When the original repository gets improvements: on GitHub, open your copy → **Sync fork** →
**Update branch** (if your copy was created as a clone rather than a fork, pull from the original
with git). Vercel deploys the new version automatically and the build applies any new database
migrations before the app goes live.

Preview deployments (other branches, pull requests) never touch your database's schema; only
production deploys migrate.

---

## Reference: environment variables

Set in Vercel → your project → **Settings → Environment Variables**, then redeploy.
`.env.example` in the repository lists the same set.

| Variable | Set by | Needed for |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Supabase integration | Sign-in |
| `POSTGRES_URL` (or `DATABASE_URL`) | Supabase integration | The app's database |
| `POSTGRES_URL_NON_POOLING` | Supabase integration | Migrations on deploy |
| `SUPABASE_URL`, `SUPABASE_SECRET_KEY` (or `SUPABASE_SERVICE_ROLE_KEY`) | Supabase integration | Backup fallback to Supabase Storage |
| `OWNER_EMAIL` | You (Deploy button) | Only this email can claim the deployment |
| `CRON_SECRET` | You (Deploy button) | Nightly backup and the daily job (`/api/cron/daily`) |
| `STRAVA_CLIENT_ID`, `STRAVA_CLIENT_SECRET`, `STRAVA_WEBHOOK_VERIFY_TOKEN` | You (step 4b, optional) | Strava; unset = no Strava anywhere |
| `BACKUP_GITHUB_REPO`, `BACKUP_GITHUB_TOKEN`, `BACKUP_GITHUB_BRANCH` (optional) | You (step 5) | Nightly backup |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | You (step 6) | Push notifications |
| `SITE_URL` | Optional | Your public URL, if you add a custom domain |
| `SKIP_MIGRATIONS=1`, `MIGRATE_PREVIEW=1`, `MIGRATIONS_DATABASE_URL` | Optional | Control the deploy-time migrations |
| `WGER_BASE_URL`, `HEVY_BASE_URL`, `STRAVA_API_BASE`, `STRAVA_OAUTH_BASE` | Optional | Alternative service hosts |

## Reference: running migrations by hand

Production deploys run `npm run db:deploy` before `next build`. To run it yourself (for example
against a new project):

```sh
POSTGRES_URL_NON_POOLING='postgres://…:5432/postgres' OWNER_EMAIL=you@example.com npm run db:deploy
```

It applies, in order, every file in `supabase/migrations` not yet recorded in
`supabase_migrations.schema_migrations` (the Supabase CLI's own history table, so
`supabase db push` works alongside it).
