# Personio Auto-Timer

Automated Personio time-tracking via browser automation. A Dockerized Node.js + Playwright service triggers Personio's UI to start, pause, resume, and stop your work timer — called from your phone, Mac, or any HTTP client when you arrive at or leave the office.

## Architecture

```
                                  ┌─────────────────────────────────┐
  iPhone (Shortcuts)              │   Hetzner VPS                   │
  Android (MacroDroid/Tasker)     │                                 │
  macOS (Menu Bar App)       ───► │   Caddy ──► Express API ──►     │
  macOS (Wi-Fi Monitor)           │              (Docker)           │
  curl / any HTTP client          │                Playwright ──►   │
                                  │                  Personio UI    │
                                  └─────────────────────────────────┘
```

### How It Works

1. A trigger event occurs (Wi-Fi connect/disconnect, screen unlock, manual click)
2. An HTTPS POST request is sent to the API with a bearer token
3. The server validates auth, checks safety guards (weekend, time window, cooldown, mutex)
4. Playwright opens a headless Chromium with a persistent login session
5. The automation navigates to Personio and clicks the appropriate button
6. The result is returned as structured JSON

### Safety Guards

Every trigger passes through these checks before running:

| Guard | Purpose |
|-------|---------|
| **Bearer token** | Only requests with the correct token are accepted |
| **Weekend check** | Rejects triggers on Saturday/Sunday |
| **Time window** | Start: 5-12h, Break/Resume: 12-14h (configurable) |
| **Cooldown** | Per-action 15-minute cooldown prevents duplicate triggers |
| **Mutex** | Only one automation runs at a time |

### Compliance

This tool does **not** falsify working hours. It only starts the timer when you are physically present — verified by your phone's Wi-Fi connection to the office network or your physical interaction with your Mac. The server-side guards prevent accidental triggers.

---

## API Endpoints

All endpoints require: `Authorization: Bearer <TRIGGER_TOKEN>`

### GET /health

Returns service status, uptime, and guard states.

```json
{
    "status": "ok",
    "uptime": 3600,
    "timestamp": "2026-05-19T08:00:00.000Z",
    "guards": {
        "weekday": true,
        "withinWindow": true,
        "cooldowns": {
            "start": true,
            "break": true,
            "resume": true,
            "stop": true
        },
        "localTime": "Mon 8:xx (Europe/Berlin)"
    }
}
```

### POST /trigger/start

Clicks "Arbeitsbeginn erfassen". Time window: `ALLOWED_START_HOUR` - `ALLOWED_END_HOUR`.

### POST /trigger/break

Clicks "Pause machen". Time window: `BREAK_START_HOUR` - `BREAK_END_HOUR`.

### POST /trigger/resume

Clicks "Weiterarbeiten". Time window: `BREAK_START_HOUR` - `BREAK_END_HOUR`.

### POST /trigger/stop

Clicks "Arbeitsende erfassen". No time window restriction.

### Response Statuses

| Status | HTTP | Description |
|--------|------|-------------|
| `started` | 200 | Timer started successfully |
| `already_started` | 200 | Timer was already running |
| `break_started` | 200 | Break started successfully |
| `already_on_break` | 200 | Already on break |
| `resumed` | 200 | Resumed from break |
| `already_working` | 200 | Already working (not on break) |
| `stopped` | 200 | Timer stopped successfully |
| `already_stopped` | 200 | Timer was already stopped |
| `skipped_weekend` | 200 | Today is a weekend |
| `skipped_outside_time_window` | 200 | Outside allowed hours |
| `skipped_cooldown` | 200 | Cooldown still active |
| `failed` | 500 | Automation failed |
| — | 401 | Missing or invalid token |
| — | 409 | Another automation already running |

---

## Server Setup

### Prerequisites

- A VPS with Docker and Docker Compose
- A domain with DNS pointing to the VPS
- Caddy (or another reverse proxy) for HTTPS

### 1. Clone and Configure

```bash
ssh your-server
cd /opt/apps
git clone git@github.com:LucaGerlich/personioTimerAutomation.git
cd personioTimerAutomation
git checkout development

cp .env.example .env
nano .env
```

Generate a secure trigger token:

```bash
openssl rand -hex 32
```

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | API server port | `3000` |
| `TRIGGER_TOKEN` | Bearer token for authentication | (required) |
| `PERSONIO_URL` | Your Personio instance URL | (required) |
| `PERSONIO_EMAIL` | Your Personio login email | (required) |
| `PERSONIO_PASSWORD` | Your Personio password | (required) |
| `HEADLESS` | Run browser headless | `true` |
| `COOLDOWN_MINUTES` | Cooldown between triggers per action | `15` |
| `ALLOWED_START_HOUR` | Start trigger window begin (24h) | `5` |
| `ALLOWED_END_HOUR` | Start trigger window end (24h) | `12` |
| `BREAK_START_HOUR` | Break/resume window begin (24h) | `12` |
| `BREAK_END_HOUR` | Break/resume window end (24h) | `14` |
| `TIMEZONE` | Timezone for all time checks | `Europe/Berlin` |

### 2. Docker Compose with Caddy

Create `docker-compose.yml` for Caddy integration (no exposed ports — Caddy handles TLS and routing):

```yaml
services:
  personio-timer:
    build: .
    container_name: personio-timer
    restart: unless-stopped
    volumes:
      - ./storage:/app/storage
    env_file:
      - .env
    environment:
      - STORAGE_PATH=/app/storage
    networks:
      - caddy_net

networks:
  caddy_net:
    external: true
```

Ensure the Docker network exists and your Caddy container is also on it:

```bash
docker network create caddy_net
```

Add to your Caddyfile:

```
timer.yourdomain.com {
    reverse_proxy personio-timer:3000
}
```

Reload Caddy:

```bash
docker exec caddy caddy reload --config /etc/caddy/Caddyfile
```

### 3. Build and Start

```bash
docker compose build
docker compose up -d
```

### 4. First Login

The initial login saves session cookies to the persistent browser profile so the automation can reuse them.

```bash
docker compose run -it personio-timer npm run login
```

The script enters your email and password automatically (from `.env`), takes screenshots at each step (saved to `./storage/screenshots/`), and saves the session.

### 5. Verify

```bash
# Health check
curl https://timer.yourdomain.com/health

# Test trigger
curl -X POST \
  -H "Authorization: Bearer YOUR_TOKEN" \
  https://timer.yourdomain.com/trigger/start
```

---

## Client Setup

### iOS (Shortcuts — free, built-in)

Create four automations in the Shortcuts app → Automation tab:

| Automation | Trigger | Time Condition | Endpoint |
|------------|---------|---------------|----------|
| Start Timer | Wi-Fi Connected → [Work SSID] | — | `/trigger/start` |
| Break | Wi-Fi Disconnected → [Work SSID] | 12:00-14:00 | `/trigger/break` |
| Resume | Wi-Fi Connected → [Work SSID] | 12:00-14:00 | `/trigger/resume` |
| Stop Timer | Wi-Fi Disconnected → [Work SSID] | After 14:00 | `/trigger/stop` |

Each automation action: **Get Contents of URL**
- URL: `https://timer.yourdomain.com/trigger/<action>`
- Method: POST
- Headers: `Authorization` = `Bearer YOUR_TOKEN`

Disable "Ask Before Running" for each automation.

### Android (MacroDroid — free)

Create four macros in MacroDroid:

| Macro | Trigger | Constraint | Action URL |
|-------|---------|-----------|------------|
| Start Timer | Wi-Fi Connected → [Work SSID] | — | `/trigger/start` |
| Break | Wi-Fi Disconnected → [Work SSID] | Time 12:00-14:00 | `/trigger/break` |
| Resume | Wi-Fi Connected → [Work SSID] | Time 12:00-14:00 | `/trigger/resume` |
| Stop Timer | Wi-Fi Disconnected → [Work SSID] | Time after 14:00 | `/trigger/stop` |

Each action: HTTP Request → POST with `Authorization: Bearer YOUR_TOKEN` header.

### macOS

Two components work together:

#### Menu Bar App

A native Swift menu bar app with manual Start/Break/Resume/Stop buttons and automatic resume-on-screen-unlock during break hours.

**Setup:**

```bash
cd macos
cp config.env.example config.env
nano config.env    # Set TRIGGER_URL, TRIGGER_TOKEN, and optionally BREAK_START/END_HOUR
./install.sh
open ~/Applications/PersonioTimer.app
```

**Add to Login Items** so it starts automatically:
System Settings → General → Login Items → add `~/Applications/PersonioTimer.app`

**Features:**
- Menu bar icon (⏱) with Start, Break, Resume, Stop buttons
- Shows last action status
- Auto-resume on screen unlock during break hours (12:00-14:00)
- Toggle auto-resume on/off from the menu
- 5-minute cooldown prevents duplicate triggers

#### Wi-Fi Monitor

A background shell script (launchd agent) that monitors Wi-Fi state changes and triggers the appropriate endpoint.

**Setup:**
The `install.sh` script above installs both the menu bar app and the Wi-Fi monitor. The Wi-Fi monitor runs every 30 seconds and only acts on state transitions (connect/disconnect from your work SSID).

**Logs:**

```bash
tail -f ~/Library/Logs/personio-timer.log
```

**Uninstall both:**

```bash
cd macos
./uninstall.sh
```

#### macOS Config (`macos/config.env`)

| Variable | Description | Default |
|----------|-------------|---------|
| `WORK_SSID` | Your work Wi-Fi network name | (required) |
| `TRIGGER_URL` | API base URL | (required) |
| `TRIGGER_TOKEN` | Bearer token (without "Bearer " prefix) | (required) |
| `BREAK_START_HOUR` | Break window start | `12` |
| `BREAK_END_HOUR` | Break window end | `14` |

---

## CLI Commands

| Command | Description |
|---------|-------------|
| `npm start` | Start the API server |
| `npm run login` | Interactive login (saves session) |
| `npm run start-timer` | Test start automation directly |
| `npm run start-timer break` | Test break automation directly |
| `npm run start-timer resume` | Test resume automation directly |
| `npm run start-timer stop` | Test stop automation directly |

Docker equivalents:

```bash
docker compose up -d                                              # Start server
docker compose logs -f                                            # View logs
docker compose run -it personio-timer npm run login               # Login
docker compose exec personio-timer npm run start-timer            # Test start
docker compose exec personio-timer npm run start-timer break      # Test break
```

---

## Customizing Personio Selectors

The automation uses button texts captured from a German-language Personio instance. If your Personio uses different button labels, update the `SELECTORS` object in `src/personio.ts`:

```typescript
const SELECTORS = {
    emailInput: 'E-Mail-Adresse',
    passwordInput: 'Passwort',
    continueButton: 'Fortfahren',
    startTimerButton: 'Arbeitsbeginn erfassen',
    stopTimerButton: 'Arbeitsende erfassen',
    breakButton: 'Pause machen',
    resumeButton: 'Weiterarbeiten',
}
```

### Finding Your Selectors

Use Playwright's code generator to discover the correct selectors:

```bash
npx playwright codegen https://your-company.personio.de
```

Click through the Personio UI — the codegen panel shows the selectors as you interact with each element. Copy the button names into the `SELECTORS` object.

---

## Troubleshooting

### Login session expired

Re-run the login script:

```bash
docker compose run -it personio-timer npm run login
```

Check `./storage/screenshots/` to see what the browser encountered.

### Automation fails with "could not verify"

The button selector might not match. Check the error screenshot in `./storage/screenshots/` and update `SELECTORS` in `src/personio.ts`.

### Browser profile corrupted

Delete and re-login:

```bash
rm -rf ./storage/personio-browser-profile
docker compose run -it personio-timer npm run login
```

### macOS menu bar app shows "failed"

Run the app from the terminal to see error details:

```bash
pkill PersonioTimer
cd macos
./build/PersonioTimer.app/Contents/MacOS/PersonioTimer
```

Common issues: wrong token in `config.env` (don't include "Bearer " prefix), wrong URL, server not running.

### Wi-Fi monitor triggers stop repeatedly

If the timer keeps stopping on its own, the Wi-Fi monitor may be misfiring. Check the logs:

```bash
cat ~/Library/Logs/personio-timer.log
```

If you see repeated `unknown → disconnected` transitions, the state file is not persisting. Verify it exists:

```bash
cat ~/.personio-wifi-state
```

If the SSID in the log shows `none` while you're connected, the SSID in `config.env` may not match exactly. Check:

```bash
# What macOS reports:
networksetup -getairportnetwork en0

# What's configured:
grep WORK_SSID macos/config.env
```

The SSID must match exactly (case-sensitive, including spaces).

### Container shows "unhealthy"

Check if the Express server is actually running:

```bash
docker logs personio-timer --tail 20
```

Ensure `PORT` in `.env` matches what Caddy expects (default: 3000).

---

## Project Structure

```
personioAutoTimer/
  src/
    server.ts        Express API with /health and /trigger/* endpoints
    personio.ts      Playwright automation: login, navigate, click buttons
    cooldown.ts      Per-action cooldown, weekend/time-window guards
    config.ts        Environment variable validation
    types.ts         Shared TypeScript types
    login.ts         Interactive login CLI script
    cli.ts           Direct automation test CLI
  macos/
    PersonioTimer.swift   Native menu bar app (Swift)
    wifi-monitor.sh       Wi-Fi state change monitor (bash)
    build.sh              Compiles the Swift app
    install.sh            Installs menu bar app + Wi-Fi monitor
    uninstall.sh          Removes both
    config.env.example    Client-side configuration template
    dev.lucagerlich.personio-timer.plist   launchd agent template
  Dockerfile              Based on mcr.microsoft.com/playwright
  docker-compose.yml      Docker Compose with Caddy network support
  .env.example            Server-side configuration template
  package.json            Node.js dependencies and scripts
  tsconfig.json           TypeScript configuration
```

---

## Security

- **Never commit `.env` or `config.env`** — both are in `.gitignore`
- **Use a long random trigger token** — `openssl rand -hex 32`
- **Always use HTTPS** — Caddy provides automatic TLS
- **Credentials are only stored on the server** — the macOS/phone clients only know the trigger token and URL, never the Personio credentials
- **Persistent browser session** — after the initial login, credentials are not sent again. The session cookies handle authentication.

## Known Limitations

- **UI automation is inherently fragile** — Personio UI updates can break selectors at any time. Re-run `npx playwright codegen` to find updated selectors.
- **Session expiry** — Personio sessions eventually expire. Re-run `npm run login` when this happens.
- **Single instance** — cooldown and mutex are in-memory. Not designed for horizontal scaling.
- **macOS Wi-Fi detection** — uses `networksetup -getairportnetwork en0`. If your Wi-Fi interface is different (e.g., `en1`), update `wifi-monitor.sh`.
- **Company policy** — ensure automated time tracking is permitted by your employer before using this tool.
