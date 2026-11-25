import { fork } from 'node:child_process'
import { join } from 'node:path'
import type { ActionResult, PersonioAction } from './types.ts'

const CLI_PATH = join(import.meta.dirname, 'cli.ts')

// ponytail: fixed 2-minute cap per run. Playwright's own timeouts end a normal run well before this;
// make it configurable only if Personio ever gets slow enough to hit it.
const RUN_TIMEOUT_MS = 120_000

/**
 * Runs one automation in a short-lived child process (`node src/cli.ts <action>`).
 *
 * Playwright and Chromium only ever load in the child, so the server stays small while idle,
 * and everything a run allocated goes back to the OS when the child exits.
 * Never rejects: every outcome, including a crash or timeout, becomes an ActionResult.
 */
export function runActionInChild(action: PersonioAction): Promise<ActionResult> {
	return new Promise((resolve) => {
		let result: ActionResult | null = null
		const child = fork(CLI_PATH, [action], { timeout: RUN_TIMEOUT_MS })

		child.on('message', (message) => {
			if (isActionResult(message)) result = message
		})
		child.on('error', (error) => {
			resolve({ status: 'failed', message: `Could not run automation process: ${error.message}` })
		})
		// 'close' (not 'exit') fires only after the IPC channel is drained, so the result can't be missed
		child.on('close', (code, signal) => {
			resolve(result ?? { status: 'failed', message: describeChildFailure(code, signal) })
		})
	})
}

/** Narrows the IPC payload from the child. */
function isActionResult(value: unknown): value is ActionResult {
	if (typeof value !== 'object' || value === null) return false
	const { status, message, screenshotPath } = value as Record<string, unknown>
	return typeof status === 'string'
		&& typeof message === 'string'
		&& (screenshotPath === undefined || typeof screenshotPath === 'string')
}

const LOGS_HINT = 'Check: docker logs personio-timer'

/**
 * Message returned to the caller (phone, Mac app, curl) when the child ended without sending a result.
 * Kept short: it usually ends up in a phone or menu bar notification.
 */
function describeChildFailure(code: number | null, signal: NodeJS.Signals | null): string {
	// fork's `timeout` kills with SIGTERM
	if (signal === 'SIGTERM') return `Timed out after ${RUN_TIMEOUT_MS / 1000}s and was stopped. Try again. ${LOGS_HINT}`
	// The kernel OOM killer uses SIGKILL
	if (signal === 'SIGKILL') return `Automation was killed (SIGKILL), possibly out of memory. ${LOGS_HINT}`
	if (signal) return `Automation was killed (${signal}). ${LOGS_HINT}`
	if (code === 0) return `Automation exited without reporting a result. ${LOGS_HINT}`
	return `Automation crashed (exit code ${code}). ${LOGS_HINT}`
}
