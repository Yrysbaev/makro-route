# Makro Route – Deployment Guide

This app is a Next.js 16 project. The recommended way to deploy is **Vercel** (same team as Next.js; zero config).

---

## 1. Prerequisites

- **Google Cloud project** with Sheets API enabled and a **service account** (JSON key).
- A **Google Sheet** to use as the database (create one and note its ID from the URL).
- **Node.js 18+** locally (for running the bootstrap script).

---

## 2. Deploy to Vercel

### Option A: Deploy with Vercel CLI

```bash
npm i -g vercel
vercel login
vercel
```

Follow the prompts (link to existing project or create new). Then add env vars (see below) in the Vercel dashboard or via CLI.

### Option B: Deploy from GitHub

1. Push this repo to GitHub.
2. Go to [vercel.com](https://vercel.com) → **Add New Project** → **Import** your repo.
3. Leave **Build Command** as `npm run build` and **Output Directory** empty.
4. Add the environment variables in the project **Settings → Environment Variables** (see section 3).
5. Deploy.

---

## 3. Environment Variables

Set these in **Vercel → Project → Settings → Environment Variables** (for Production, and optionally Preview).

| Variable | Required | Description |
|----------|----------|-------------|
| `SESSION_SECRET` | **Yes** | Random secret for signing session cookies (e.g. `openssl rand -hex 32`). **Must be set in production.** |
| `GOOGLE_SHEETS_SPREADSHEET_ID` | **Yes** | The ID of your Google Sheet (from the URL: `https://docs.google.com/spreadsheets/d/<THIS_ID>/edit`). |
| `GOOGLE_SHEETS_CLIENT_EMAIL` | **Yes** | Service account email (e.g. `xxx@xxx.iam.gserviceaccount.com`). |
| `GOOGLE_SHEETS_PRIVATE_KEY` | **Yes** | Private key from the service account JSON. Paste the full key including `-----BEGIN PRIVATE KEY-----` and `-----END PRIVATE KEY-----`. In Vercel you can paste as-is; escape newlines as `\n` if your key is in one line. |
| `GOOGLE_SHEETS_TAB_CUSTOMERS` | No | Sheet tab name for customers (default: `customers`). |
| `GOOGLE_SHEETS_TAB_TRIPS` | No | Sheet tab name for trips (default: `trips`). |
| `GOOGLE_SHEETS_TAB_TRIP_STOPS` | No | Sheet tab name for trip stops (default: `trip_stops`). |
| `GOOGLE_SHEETS_TAB_TRIP_EVENTS` | No | Sheet tab name for trip events (default: `trip_events`). |
| `GOOGLE_SHEETS_TAB_DELIVERY_HISTORY` | No | Sheet tab name for delivery history (default: `delivery_history`). |

**Generate a secure `SESSION_SECRET`:**

```bash
openssl rand -hex 32
```

---

## 4. Bootstrap Google Sheets (first-time setup)

The app expects your Google Sheet to have tabs with the right headers. Run the bootstrap script **once** after deployment (or before, using the same env vars you’ll use in production).

**From your machine** (using production env vars):

1. Copy `.env.example` to `.env.local` (or `.env.production.local`).
2. Fill in the same values you set in Vercel (same spreadsheet, same service account).
3. Run:

```bash
npm run bootstrap:sheets
```

This creates the required tabs and headers in the spreadsheet. If the **customers** tab is empty, it will seed it from `lib/customers-data.json` (if that file exists).

You can also run the script with env vars set only in the shell, or use a small Node script that loads from a secret store; the important part is that the same spreadsheet and service account are used in the app and for bootstrap.

---

## 5. After deployment

- Open your Vercel URL (e.g. `https://your-project.vercel.app`).
- You should see the login page. Use the driver credentials defined in `lib/auth.ts` (or change them there and redeploy).
- Session cookies are set with `secure: true` when the request is HTTPS (handled automatically behind Vercel).

---

## 6. Optional: self-hosted (Docker / Node)

To run the app yourself (e.g. on a VPS or Docker):

1. Set **all** of the env vars above in the host environment.
2. Build and start:

```bash
npm ci
npm run build
npm run start
```

The app listens on the port set by `PORT` (default `3000`).

For Docker, you can use a `Dockerfile` that runs `npm run build` and `npm start` and pass env vars at runtime. Next.js does not require `output: 'standalone'` for a simple `npm run start` deployment.

---

## 7. Troubleshooting

- **Login works locally but not after deploy**  
  Ensure `SESSION_SECRET` is set in Vercel and that you’re using HTTPS. The app sets the cookie as `secure` when `x-forwarded-proto` is `https`.

- **“Missing required env var: GOOGLE_SHEETS_…”**  
  Add the three required Google Sheets env vars in Vercel and redeploy.

- **Sheets API errors (403, 404)**  
  Confirm the service account email has been given **Editor** access to the Google Sheet (Share button on the sheet).

- **Build fails on Vercel**  
  The project uses `next build --webpack`. Vercel runs `npm run build`, which already includes `--webpack`. If you overrode the build command in the dashboard, set it back to `npm run build`.
