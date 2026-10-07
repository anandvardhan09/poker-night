# Poker Night

Texas Hold'em with friends, with live video and audio for each player at their seat. Play money only.

- **Web** (`apps/web`): React + Vite + Tailwind, hosted on Vercel.
- **Game server** (`apps/server`): Node + Socket.IO, hosted on Render. It is the authority on the game: it deals, checks every action, runs the turn timers and sends each player only their own hole cards.
- **Shared** (`packages/shared`): socket event and state types.
- **Database and auth**: Supabase (Google sign-in, plus Postgres for profiles, chip balances, seats, table snapshots and hand history).
- **Video**: peer-to-peer WebRTC between seated players. The game server relays the connection-setup messages. Works well up to about 6 players.

## Run locally

```bash
npm install
npm run dev          # server on :3001, web on :5173
npm test             # engine tests (blinds, side pots, split pots, chip conservation)
```

Without Supabase settings, the app runs in **dev mode**: you log in with just a name, and data is saved to `apps/server/.data/dev-db.json`. Open several browser profiles or windows to play against yourself. Camera access only works on `localhost` or over HTTPS.

`npm run smoke -w @pk/server` runs an end-to-end bot game against a running dev server. It checks seat retention on disconnect, reconnection, and recovery after a restart.

## How saved state works

- Every action saves a snapshot of the table to `table_snapshots`. If the server restarts or wakes from sleep, it reloads the table and the hand continues where it left off.
- Buying in moves chips from your balance to your stack. Standing up moves them back. Balances are changed with an atomic SQL function that never goes negative.
- If you disconnect, your seat and stack are kept. While you're gone, your turns auto-check or auto-fold after 30 seconds. After 2 missed hands you're set to sit out, and you're sat back in automatically when you return. Reopening the table link (or "Your seats" in the lobby) restores your seat, your cards and your video.

## Deploy (all free tiers)

### 1. Push to GitHub

```bash
git add . && git commit -m "Poker Night"
gh repo create poker-night --private --source . --push
```

### 2. Supabase (database + Google login)

1. Create a project at [supabase.com](https://supabase.com).
2. In **SQL Editor**, run [`supabase/migrations/001_init.sql`](supabase/migrations/001_init.sql).
3. Create a Google OAuth client in the [Google Cloud Console](https://console.cloud.google.com/apis/credentials):
   - Configure the OAuth consent screen (External). Either add your friends as test users or publish the app.
   - Create credentials: **OAuth client ID**, type **Web application**.
   - Authorized redirect URI: `https://<your-project-ref>.supabase.co/auth/v1/callback`
4. In Supabase, go to **Authentication > Providers > Google**. Enable it and paste the client ID and secret.
5. In **Authentication > URL Configuration**:
   - Set **Site URL** to your Vercel URL (from step 4).
   - Add these **Redirect URLs**: `https://<your-app>.vercel.app/**` and `http://localhost:5173/**`.
6. From **Project Settings > API**, note:
   - the project URL
   - the anon (publishable) key, which goes in the web app
   - the service_role (secret) key, which goes on the **server only**

### 3. Render (game server)

1. Go to **New > Blueprint** and pick the repo. It reads [`render.yaml`](render.yaml).
2. Fill in the environment variables:
   - `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
   - `CLIENT_ORIGIN`: your Vercel URL, e.g. `https://poker-night.vercel.app`. Separate several URLs with commas.
   - Optional: `SUPABASE_JWT_SECRET`, the legacy HS256 secret, for faster token checks. Without it, tokens are verified through Supabase Auth.
   - Optional TURN relay, see below: `TURN_URLS`, `TURN_USERNAME`, `TURN_CREDENTIAL`
3. Note the service URL, e.g. `https://poker-night-server.onrender.com`.

### 4. Vercel (web app)

1. **Add New > Project** and import the repo. Keep the root directory as the repository root; [`vercel.json`](vercel.json) handles the build.
2. Set these environment variables:
   - `VITE_SERVER_URL`: the Render URL
   - `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`
3. Deploy. If the final URL differs from what you put in Render's `CLIENT_ORIGIN` or Supabase's redirect URLs, update those.

### 5. TURN relay (recommended)

Most players connect directly using STUN. Players behind strict corporate or mobile NATs need a TURN relay. [Metered.ca](https://www.metered.ca/stun-turn) has a free tier (about 500 MB/month) with static credentials:

```
TURN_URLS=turn:global.relay.metered.ca:80,turn:global.relay.metered.ca:443?transport=tcp
TURN_USERNAME=<from dashboard>
TURN_CREDENTIAL=<from dashboard>
```

## Free-tier limits

- **Render** sleeps after 15 idle minutes, and the first visit then takes about 50 seconds while the app shows "Server is waking up…". While anyone has the app open, it pings `/health` every 4 minutes to keep the server awake. Saved snapshots mean a sleep never loses a game.
- **Supabase** pauses projects after 7 days without activity. Resume it from the dashboard.
- **Video** is a full mesh, so each player uploads one stream per other player. Video is capped at 320x240 and 15 fps so 6 players stay smooth on home internet.
