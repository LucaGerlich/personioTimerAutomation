# Personio Auto-Timer

Dockerized Node.js + Playwright service that starts your Personio time-tracking timer via an authenticated HTTP request. Designed to be triggered from your smartphone when connecting to your work Wi-Fi network.

## How It Works

```
Phone (Tasker/Shortcuts)
    |
    | HTTPS POST /trigger/start
    | Authorization: Bearer <token>
    v
Caddy (reverse proxy, TLS)
    |
    v
Express API (Docker)
    |
    | Guards: auth, weekday, time window, cooldown, mutex
    |
    v
Playwright (headless Chromium)
    |
    | Opens Personio, logs in if needed, clicks "Start Timer"
    v
Personio Web UI
```

### Safety Guards

The service includes multiple safeguards against accidental or duplicate triggers:

- **Bearer token authentication** - only requests with the correct token are accepted
- **Weekend detection** - rejects triggers on Saturday/Sunday
- **Time window** - only allows triggers between configured hours (default: 5:00-12:00)
- **Cooldown** - prevents re-triggering within a configurable period (default: 15 minutes)
- **Mutex** - only one automation can run at a time

## Prerequisites

- Docker and Docker Compose
- A Personio account with attendance/time-tracking enabled
- A VPS or server to host the service
- (Optional) Caddy for HTTPS reverse proxy
- (Optional) Tasker (Android) or Shortcuts (iOS) for phone automation

## Quick Start

### 1. Clone and Configure

```bash
cp .env.example .env
```

Edit `.env` and fill in your values:

```bash
# Generate a secure trigger token
openssl rand -hex 32
```

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | API server port | `3000` |
| `TRIGGER_TOKEN` | Bearer token for authentication | (required) |
| `PERSONIO_URL` | Your Personio instance URL | (required) |
| `PERSONIO_EMAIL` | Your Personio login email | (required) |
| `PERSONIO_PASSWORD` | Your Personio password | (required) |
| `HEADLESS` | Run browser headless | `true` |
| `COOLDOWN_MINUTES` | Minutes between allowed triggers | `15` |
| `ALLOWED_START_HOUR` | Earliest trigger hour (24h) | `5` |
| `ALLOWED_END_HOUR` | Latest trigger hour (24h) | `12` |
| `TIMEZONE` | Timezone for time checks | `Europe/Berlin` |

### 2. Build and Run

```bash
docker compose build
docker compose up -d
```

### 3. First Login (Manual)

Before the automation can work, you need to complete the initial login manually. This saves the session cookies to the persistent browser profile.

```bash
# Expose the debugging port
docker compose run --service-ports -p 9222:9222 personio-timer npm run login
```

Then:
1. Open Chrome/Edge on your computer
2. Go to `chrome://inspect`
3. Click "Configure..." and add `YOUR_VPS_IP:9222`
4. Click "inspect" on the listed page
5. Complete the login process (email, password, SSO, MFA)
6. Once logged in, press `Ctrl+C` in the terminal to save and exit

The session is now saved in `./storage/personio-browser-profile/` and will persist across container restarts.

### 4. Test with curl

```bash
# Health check
curl http://localhost:3000/health

# Trigger (replace YOUR_TOKEN)
curl -X POST \
  -H "Authorization: Bearer YOUR_TOKEN" \
  http://localhost:3000/trigger/start

# Test without auth (should return 401)
curl -X POST http://localhost:3000/trigger/start
```

### 5. Caddy Setup (HTTPS)

Edit `docker-compose.yml`:
1. Remove the `ports` section
2. Uncomment the `networks` sections

Add to your Caddyfile:
```
timer.yourdomain.com {
    reverse_proxy personio-timer:3000
}
```

## Tasker Integration (Android)

Create a Tasker profile that triggers when connecting to your work Wi-Fi:

### Profile
- **Trigger**: State > Net > WiFi Connected
- **SSID**: Your work WiFi network name

### Task: Start Personio Timer
1. **Action**: Net > HTTP Request
   - Method: POST
   - URL: `https://timer.yourdomain.com/trigger/start`
   - Headers: `Authorization: Bearer YOUR_TOKEN`
   - Timeout: 60 seconds
2. **Action**: Alert > Flash (optional)
   - Text: `Personio: %http_data`

### iOS Shortcuts Alternative
1. Create a new Automation
2. Trigger: "When I connect to Wi-Fi [Work SSID]"
3. Action: "Get Contents of URL"
   - URL: `https://timer.yourdomain.com/trigger/start`
   - Method: POST
   - Headers: Authorization = Bearer YOUR_TOKEN

## Customizing Personio Selectors

The automation uses placeholder selectors that may not match your Personio instance. You need to customize them.

### Using Playwright Codegen

The easiest way to find the correct selectors is to use Playwright's code generator:

```bash
# Run codegen against your Personio instance
npx playwright codegen https://your-company.personio.de
```

This opens a browser with a recording panel. As you click through the Personio UI, it generates the selectors you need.

### What to Customize

Open `src/personio.ts` and update the `SELECTORS` object at the top of the file:

```typescript
const SELECTORS = {
    // Login page
    emailInput: '...',        // Email field selector
    passwordInput: '...',     // Password field selector
    loginButton: /log in/i,   // Login button text

    // Navigation
    attendanceNavItem: /attendance/i,  // Nav item text

    // Timer controls
    startTimerButton: /start/i,        // Start button text
    timerRunningIndicator: /stop/i,    // Running state indicator
}
```

Also update `openTimeTracking()` if the direct URL approach doesn't work for your instance.

### Tips

- Prefer `getByRole('button', { name: /text/i })` over CSS selectors
- Use case-insensitive regex to handle language variations
- Test with `npm run start-timer` after each change
- Check screenshots in `./storage/screenshots/` when things fail

## CLI Commands

| Command | Description |
|---------|-------------|
| `npm start` | Start the API server |
| `npm run login` | Open browser for manual login |
| `npm run start-timer` | Test automation directly |

In Docker:
```bash
docker compose up -d                    # Start server
docker compose logs -f                  # View logs
docker compose exec personio-timer npm run start-timer  # Test automation
docker compose run --service-ports -p 9222:9222 personio-timer npm run login  # Manual login
```

## API Reference

### GET /health

Returns service health and guard status.

```json
{
    "status": "ok",
    "uptime": 3600,
    "timestamp": "2026-05-19T08:00:00.000Z",
    "guards": {
        "weekday": true,
        "withinWindow": true,
        "cooldownClear": true,
        "localTime": "Mon 8:xx (Europe/Berlin)"
    }
}
```

### POST /trigger/start

Requires: `Authorization: Bearer <TRIGGER_TOKEN>`

Response statuses:

| Status | HTTP | Description |
|--------|------|-------------|
| `started` | 200 | Timer was successfully started |
| `already_started` | 200 | Timer was already running |
| `skipped_weekend` | 200 | Rejected: today is a weekend |
| `skipped_outside_time_window` | 200 | Rejected: outside allowed hours |
| `skipped_cooldown` | 200 | Rejected: cooldown still active |
| `failed` | 500 | Automation failed (check logs/screenshots) |
| (no auth) | 401 | Missing or invalid token |
| (busy) | 409 | Another automation is already running |

## Troubleshooting

### Login session expired

Run the manual login again:
```bash
docker compose run --service-ports -p 9222:9222 personio-timer npm run login
```

### MFA required

If your company uses MFA/2FA, you may need to complete manual login periodically when the MFA token expires.

### Selectors not working

1. Check screenshots in `./storage/screenshots/`
2. Run `npx playwright codegen` to find updated selectors
3. Update `SELECTORS` in `src/personio.ts`

### Browser profile corrupted

Delete the profile and re-login:
```bash
rm -rf ./storage/personio-browser-profile
docker compose run --service-ports -p 9222:9222 personio-timer npm run login
```

## Security Warnings

- **Use a long, random trigger token** — generate with `openssl rand -hex 32`
- **Always use HTTPS** — do not expose the endpoint over plain HTTP
- **Do not commit `.env`** — it's in `.gitignore` by default
- **Avoid storing plain credentials** if SSO with session persistence works — complete login manually and let the session cookies handle authentication
- **Restrict network access** — consider firewall rules to only allow your phone's IP range

## Known Limitations

- **UI automation is fragile** — Personio UI updates can break selectors at any time
- **MFA may require periodic manual login** — depending on your company's MFA policy
- **Selectors must be customized** — the placeholder selectors will not work out of the box
- **Single instance only** — the cooldown and mutex are in-memory; not designed for horizontal scaling
- **Company policy** — ensure your company allows automated time tracking before using this tool. This service does not falsify working hours — it only starts the timer when you are physically present and connected to your work network
