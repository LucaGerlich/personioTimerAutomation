/**
 * CLI script to test the automation directly, bypassing the HTTP server.
 *
 * Usage:
 *   npm run start-timer [action]               (locally)
 *   docker compose exec personio-timer npm run start-timer [action]  (Docker)
 *
 * Actions: start (default), break, resume, stop
 */

import { loadConfig } from './config.ts'
import { runAction } from './personio.ts'
import type { PersonioAction } from './types.ts'

const VALID_ACTIONS: PersonioAction[] = ['start', 'break', 'resume', 'stop']

async function main(): Promise<void> {
	const config = loadConfig()
	const actionArg = process.argv[2] ?? 'start'

	if (!VALID_ACTIONS.includes(actionArg as PersonioAction)) {
		console.error(`Invalid action: "${actionArg}". Valid actions: ${VALID_ACTIONS.join(', ')}`)
		process.exit(1)
	}

	const action = actionArg as PersonioAction

	console.log('='.repeat(60))
	console.log(`  PERSONIO TIMER - DIRECT TEST (${action})`)
	console.log('='.repeat(60))
	console.log()
	console.log(`Target: ${config.personioUrl}`)
	console.log(`Action: ${action}`)
	console.log(`Headless: ${config.headless}`)
	console.log()

	const result = await runAction(config, action)

	console.log()
	console.log('='.repeat(60))
	console.log(`  Result: ${result.status}`)
	console.log(`  Message: ${result.message}`)
	if (result.screenshotPath) {
		console.log(`  Screenshot: ${result.screenshotPath}`)
	}
	console.log('='.repeat(60))

	process.exit(result.status === 'failed' ? 1 : 0)
}

main().catch((error: unknown) => {
	console.error('[cli] Fatal error:', error instanceof Error ? error.message : error)
	process.exit(1)
})
