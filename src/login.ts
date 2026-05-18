/**
 * Manual login script.
 *
 * Run this to open a Chromium instance with remote debugging enabled.
 * Connect from your browser to complete login (SSO, MFA, etc.).
 *
 * Usage:
 *   npm run login                              (locally)
 *   docker compose run --service-ports personio-timer npm run login  (Docker)
 *
 * Then open http://YOUR_HOST:9222 in your browser to see the Chromium instance.
 * Complete the login manually. The session will be saved to the persistent profile.
 *
 * Press Ctrl+C to stop when done.
 */

import { loadConfig } from './config.ts'
import { launchBrowserForLogin } from './personio.ts'

async function main(): Promise<void> {
	const config = loadConfig()

	console.log('='.repeat(60))
	console.log('  PERSONIO MANUAL LOGIN')
	console.log('='.repeat(60))
	console.log()
	console.log('Opening Chromium with remote debugging on port 9222...')
	console.log()
	console.log('To interact with the browser:')
	console.log('  1. Open Chrome/Edge on your machine')
	console.log('  2. Navigate to: chrome://inspect')
	console.log('  3. Click "Configure..." and add your VPS IP:9222')
	console.log('  4. Click "inspect" on the listed page')
	console.log()
	console.log('Or navigate directly to: http://YOUR_HOST:9222')
	console.log()
	console.log('Complete the login process (email, password, SSO, MFA).')
	console.log('Once logged in, press Ctrl+C to save the session and exit.')
	console.log()
	console.log('='.repeat(60))

	const context = await launchBrowserForLogin(config)
	const page = context.pages()[0] ?? await context.newPage()

	console.log(`[login] Navigating to ${config.personioUrl}...`)
	await page.goto(config.personioUrl, { waitUntil: 'domcontentloaded' })

	// Keep the process alive until the user presses Ctrl+C
	await new Promise<void>((resolve) => {
		const shutdown = async () => {
			console.log('\n[login] Shutting down... Session has been saved.')
			await context.close().catch(() => {})
			resolve()
		}

		process.on('SIGINT', () => void shutdown())
		process.on('SIGTERM', () => void shutdown())
	})
}

main().catch((error: unknown) => {
	console.error('[login] Fatal error:', error instanceof Error ? error.message : error)
	process.exit(1)
})
