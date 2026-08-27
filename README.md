# Card Binder server

A small API for the Card Binder app: sign up, log in, and save/load a
signed-in user's collection and want list. It's plain Node.js + Express,
storing data in Postgres.

## What's here

- `server.js` — the whole API (four routes: signup, login, get data, save data)
- `package.json` — dependencies (`express`, `pg`, `bcryptjs`, `jsonwebtoken`, `cors`, `dotenv`)
- `.env.example` — the environment variables it needs (copy to `.env` for local testing only — don't commit a real `.env`)

## Deploying on Railway

1. **Push this folder to a GitHub repo.** Railway deploys from GitHub, so create a new repo (can be private) and push these files to it.

2. **Create the project.** At [railway.com/new](https://railway.com/new), click **New Project → Deploy from GitHub repo**, authorize Railway on your GitHub account if asked, and pick the repo you just pushed.

3. **Add a Postgres database.** On the project canvas, click **+ New** (or press `Cmd/Ctrl+K`) → **Database → Add PostgreSQL**. Railway provisions it and automatically makes a `DATABASE_URL` variable available to your other services in the same project — you don't set this yourself.

4. **Set your JWT secret.** Click your app service (not the database) → **Variables** tab → **New Variable**. Add:
   - `JWT_SECRET` — any long random string. You can generate one by running `openssl rand -hex 32` in a terminal.

   Railway sets `PORT` for you automatically; the server already reads `process.env.PORT`.

5. **Deploy.** Railway builds and deploys automatically once the repo is connected (it auto-detects a Node app from `package.json` and runs `npm start`). Watch the **Deployments** tab for build/runtime logs if anything fails.

6. **Get your public URL.** Click your app service → **Settings → Networking → Public Networking → Generate Domain**. That gives you a free `*.up.railway.app` URL — this is the base URL the Card Binder page will call (e.g. `https://your-app.up.railway.app`).

7. **Verify it's alive.** Visit that URL in a browser — you should see `{"ok":true,"service":"card-binder-server"}`. If you get an error instead, check the Deployments log first (missing `JWT_SECRET` is the most common cause — the server refuses to start without it).

## API

All requests/responses are JSON.

| Method | Path | Body | Auth | Returns |
|---|---|---|---|---|
| POST | `/api/signup` | `{ name, email, password }` | — | `{ token, user: { name, email } }` |
| POST | `/api/login` | `{ email, password }` | — | `{ token, user: { name, email } }` |
| GET | `/api/data` | — | `Authorization: Bearer <token>` | `{ collection: [...], want: [...] }` |
| PUT | `/api/data` | `{ collection, want }` | `Authorization: Bearer <token>` | `{ ok: true }` |

`token` is a JWT valid for 30 days — store it (e.g. in `localStorage`) and send it as `Authorization: Bearer <token>` on `/api/data` requests.

## Next step: connect the Card Binder page to this

Right now the Card Binder artifact stores everything in the browser's own
`localStorage`, scoped per account name/email. Once this server is live,
the front-end changes are:

- Sign up / log in calls hit `POST /api/signup` / `POST /api/login` on this
  server instead of checking a local `accounts` array, and store the
  returned `token`.
- Loading/saving the collection (`loadData`, `saveCollection`, `saveWant` in
  the page's script) call `GET /api/data` / `PUT /api/data` with that token
  instead of reading/writing `localStorage`.

Send me your deployed URL once it's up and I'll wire the page's JavaScript
to call it instead of using local storage.
