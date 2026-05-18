import express, { type Request, type Response, type NextFunction } from 'express'
import { loadConfig } from './config.ts'
import { canTrigger, recordTrigger, isWeekday, isWithinTimeWindow, cooldownRemainingMinutes, getGuardStatus } from './cooldown.ts'
import { runTimerAutomation } from './personio.ts'
import type { TriggerResponse, HealthResponse } from './types.ts'

const config = loadConfig()
const app = express()

// Track whether an automation is currently running (simple mutex)
let automationRunning = false

/**
 * Bearer token authentication middleware.
 * Compares the provided token against TRIGGER_TOKEN env var.
 */
function requireAuth(req: Request, res: Response, next: NextFunction): void {
	const authHeader = req.headers.authorization
	if (!authHeader?.startsWith('Bearer ')) {
		res.status(401).json({
			status: 'failed',
			message: 'Missing or invalid Authorization header. Expected: Bearer <token>',
			timestamp: new Date().toISOString(),
		} satisfies TriggerResponse)
		return
	}

	const token = authHeader.slice(7)
	if (token !== config.triggerToken) {
		res.status(401).json({
			status: 'failed',
			message: 'Invalid trigger token.',
			timestamp: new Date().toISOString(),
		} satisfies TriggerResponse)
		return
	}

	next()
}

/**
 * GET /health
 * Returns service status, uptime, and guard states.
 */
app.get('/health', (_req: Request, res: Response) => {
	const guardStatus = getGuardStatus(config)
	res.json({
		status: 'ok',
		uptime: process.uptime(),
		timestamp: new Date().toISOString(),
		guards: guardStatus,
	} satisfies HealthResponse & { guards: ReturnType<typeof getGuardStatus> })
})

/**
 * POST /trigger/start
 * Authenticated endpoint that triggers the Personio timer automation.
 *
 * Guard chain:
 *   1. Bearer token auth
 *   2. Reject if automation already running (409)
 *   3. Weekend check
 *   4. Time window check
 *   5. Cooldown check
 *   6. Run Playwright automation
 */
app.post('/trigger/start', requireAuth, async (_req: Request, res: Response) => {
	const timestamp = new Date().toISOString()

	// Guard: concurrent automation
	if (automationRunning) {
		res.status(409).json({
			status: 'failed',
			message: 'Another automation is already in progress. Please wait.',
			timestamp,
		} satisfies TriggerResponse)
		return
	}

	// Guard: weekend
	if (!isWeekday(config)) {
		res.json({
			status: 'skipped_weekend',
			message: 'Skipped: today is a weekend.',
			timestamp,
		} satisfies TriggerResponse)
		return
	}

	// Guard: time window
	if (!isWithinTimeWindow(config)) {
		res.json({
			status: 'skipped_outside_time_window',
			message: `Skipped: current time is outside the allowed window (${config.allowedStartHour}:00 - ${config.allowedEndHour}:00 ${config.timezone}).`,
			timestamp,
		} satisfies TriggerResponse)
		return
	}

	// Guard: cooldown
	if (!canTrigger(config)) {
		const remaining = cooldownRemainingMinutes(config)
		res.json({
			status: 'skipped_cooldown',
			message: `Skipped: cooldown active. ${remaining} minute(s) remaining.`,
			timestamp,
			details: { cooldownRemainingMinutes: remaining },
		} satisfies TriggerResponse)
		return
	}

	// All guards passed — run automation
	automationRunning = true
	console.log(`[server] Trigger received at ${timestamp}. Starting automation...`)

	try {
		const result = await runTimerAutomation(config)

		// Record successful trigger for cooldown tracking
		if (result.status === 'started' || result.status === 'already_started') {
			recordTrigger()
		}

		const httpStatus = result.status === 'failed' ? 500 : 200
		res.status(httpStatus).json({
			status: result.status,
			message: result.message,
			timestamp: new Date().toISOString(),
			details: result.screenshotPath ? { screenshotPath: result.screenshotPath } : undefined,
		} satisfies TriggerResponse)
	} catch (error: unknown) {
		const errorMessage = error instanceof Error ? error.message : 'Unknown error'
		console.error(`[server] Automation error: ${errorMessage}`)
		res.status(500).json({
			status: 'failed',
			message: errorMessage,
			timestamp: new Date().toISOString(),
		} satisfies TriggerResponse)
	} finally {
		automationRunning = false
	}
})

// Start the server
app.listen(config.port, () => {
	console.log(`[server] Personio Auto-Timer running on port ${config.port}`)
	console.log(`[server] Headless mode: ${config.headless}`)
	console.log(`[server] Cooldown: ${config.cooldownMinutes} minutes`)
	console.log(`[server] Time window: ${config.allowedStartHour}:00 - ${config.allowedEndHour}:00 (${config.timezone})`)
	console.log(`[server] Browser profile: ${config.browserProfilePath}`)
})
