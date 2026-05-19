import express, { type Request, type Response, type NextFunction } from 'express'
import { loadConfig } from './config.ts'
import { canTrigger, recordTrigger, isWeekday, isWithinTimeWindow, isWithinBreakWindow, cooldownRemainingMinutes, getGuardStatus } from './cooldown.ts'
import { runAction } from './personio.ts'
import type { PersonioAction, TriggerResponse, HealthResponse } from './types.ts'

const config = loadConfig()
const app = express()

// Track whether an automation is currently running (simple mutex)
let automationRunning = false

/**
 * Bearer token authentication middleware.
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
 * Shared handler for all trigger endpoints.
 *
 * Guard chain:
 *   1. Bearer token auth (applied via middleware)
 *   2. Reject if automation already running (409)
 *   3. Weekend check
 *   4. Time window check (only for actions that need it)
 *   5. Cooldown check (per-action)
 *   6. Run Playwright automation
 */
function handleTrigger(action: PersonioAction, options: { timeWindow: 'start' | 'break' | 'none' }) {
	return async (_req: Request, res: Response) => {
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
		if (options.timeWindow === 'start' && !isWithinTimeWindow(config)) {
			res.json({
				status: 'skipped_outside_time_window',
				message: `Skipped: current time is outside the allowed window (${config.allowedStartHour}:00 - ${config.allowedEndHour}:00 ${config.timezone}).`,
				timestamp,
			} satisfies TriggerResponse)
			return
		}

		if (options.timeWindow === 'break' && !isWithinBreakWindow(config)) {
			res.json({
				status: 'skipped_outside_time_window',
				message: `Skipped: current time is outside the break window (${config.breakStartHour}:00 - ${config.breakEndHour}:00 ${config.timezone}).`,
				timestamp,
			} satisfies TriggerResponse)
			return
		}

		// Guard: per-action cooldown
		if (!canTrigger(config, action)) {
			const remaining = cooldownRemainingMinutes(config, action)
			res.json({
				status: 'skipped_cooldown',
				message: `Skipped: cooldown active for "${action}". ${remaining} minute(s) remaining.`,
				timestamp,
				details: { cooldownRemainingMinutes: remaining },
			} satisfies TriggerResponse)
			return
		}

		// All guards passed — run automation
		automationRunning = true
		console.log(`[server] Trigger "${action}" received at ${timestamp}. Starting automation...`)

		try {
			const result = await runAction(config, action)

			// Record successful trigger for cooldown tracking
			if (result.status !== 'failed') {
				recordTrigger(action)
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
	}
}

// Register all trigger endpoints
app.post('/trigger/start', requireAuth, handleTrigger('start', { timeWindow: 'start' }))
app.post('/trigger/break', requireAuth, handleTrigger('break', { timeWindow: 'break' }))
app.post('/trigger/resume', requireAuth, handleTrigger('resume', { timeWindow: 'break' }))
app.post('/trigger/stop', requireAuth, handleTrigger('stop', { timeWindow: 'none' }))

// Start the server
app.listen(config.port, () => {
	console.log(`[server] Personio Auto-Timer running on port ${config.port}`)
	console.log(`[server] Headless mode: ${config.headless}`)
	console.log(`[server] Cooldown: ${config.cooldownMinutes} minutes`)
	console.log(`[server] Time window (start only): ${config.allowedStartHour}:00 - ${config.allowedEndHour}:00 (${config.timezone})`)
	console.log(`[server] Endpoints: /trigger/start, /trigger/break, /trigger/resume, /trigger/stop`)
	console.log(`[server] Browser profile: ${config.browserProfilePath}`)
})
