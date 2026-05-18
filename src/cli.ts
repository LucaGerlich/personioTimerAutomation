/**
 * CLI script to test the timer automation directly, bypassing the HTTP server.
 *
 * Usage:
 *   npm run start-timer                    (locally)
 *   docker compose exec personio-timer npm run start-timer  (Docker)
 */

import { loadConfig } from './config.ts'
import { runTimerAutomation } from './personio.ts'

async function main(): Promise<void> {
	const config = loadConfig()

	console.log('='.repeat(60))
	console.log('  PERSONIO TIMER - DIRECT TEST')
	console.log('='.repeat(60))
	console.log()
	console.log(`Target: ${config.personioUrl}`)
	console.log(`Headless: ${config.headless}`)
	console.log()

	const result = await runTimerAutomation(config)

	console.log()
	console.log('='.repeat(60))
	console.log(`  Result: ${result.status}`)
	console.log(`  Message: ${result.message}`)
	if (result.screenshotPath) {
		console.log(`  Screenshot: ${result.screenshotPath}`)
	}
	console.log('='.repeat(60))

	process.exit(result.status === 'started' || result.status === 'already_started' ? 0 : 1)
}

main().catch((error: unknown) => {
	console.error('[cli] Fatal error:', error instanceof Error ? error.message : error)
	process.exit(1)
})
