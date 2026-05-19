/**
 * Interactive login script.
 *
 * Drives Playwright in headless mode to complete the Personio login.
 * Handles the two-step email/password flow automatically. If MFA is
 * required, prompts for the code via stdin.
 *
 * Screenshots are saved to the storage directory so you can see what
 * the browser sees at each step.
 *
 * Usage:
 *   npm run login                                       (locally)
 *   docker compose run -it personio-timer npm run login  (Docker)
 */

import { mkdirSync } from 'node:fs'
import { loadConfig } from './config.ts'
import { launchBrowser, captureScreenshot } from './personio.ts'
import type { AppConfig } from './types.ts'
import type { Page } from 'playwright'

/**
 * Takes a screenshot and tells the user where to find it.
 */
async function showState(page: Page, config: AppConfig, label: string): Promise<void> {
	const path = await captureScreenshot(page, config, `login-${label}`)
	console.log(`  Screenshot: ${path}`)
	console.log(`  (Mounted at: ./storage/screenshots/ on your host)`)
}

async function main(): Promise<void> {
	const config = loadConfig()
	mkdirSync(config.screenshotPath, { recursive: true })

	console.log('='.repeat(60))
	console.log('  PERSONIO INTERACTIVE LOGIN')
	console.log('='.repeat(60))
	console.log()
	console.log('This script will:')
	console.log('  1. Open Personio in a headless browser')
	console.log('  2. Enter your email and password automatically')
	console.log('  3. Prompt you for MFA code if needed')
	console.log('  4. Save the session for the automation service')
	console.log()
	console.log('Screenshots are saved to ./storage/screenshots/')
	console.log('so you can see what the browser sees at each step.')
	console.log()
	console.log('='.repeat(60))
	console.log()

	const context = await launchBrowser(config)
	const page = context.pages()[0] ?? await context.newPage()

	try {
		// Step 1: Navigate to Personio
		console.log('[login] Navigating to Personio...')
		await page.goto(config.personioUrl, { waitUntil: 'domcontentloaded' })
		await page.waitForTimeout(3000)
		await showState(page, config, '01-initial')

		// Check if already logged in by looking for the login form.
		// If the email field is NOT present, the session is still valid.
		const emailField = page.getByRole('textbox', { name: 'E-Mail-Adresse' })
		const loginFormVisible = await emailField.isVisible().catch(() => false)

		if (!loginFormVisible) {
			console.log()
			console.log('[login] Already logged in! Session is valid.')
			await showState(page, config, '02-already-logged-in')
			console.log()
			console.log('[login] Closing browser. Session has been saved to the persistent profile.')
			return
		}

		// Step 2: Enter email
		console.log('[login] Login form detected. Starting login flow...')
		console.log()
		console.log('[login] Entering email...')
		await emailField.waitFor({ timeout: 10000, state: 'visible' })
		await emailField.click()
		await emailField.fill(config.personioEmail)
		await page.getByRole('button', { name: 'Fortfahren' }).click()
		await page.waitForTimeout(2000)
		await showState(page, config, '02-after-email')

		// Step 3: Enter password
		console.log()
		console.log('[login] Entering password...')
		const passwordField = page.getByRole('textbox', { name: 'Passwort' })
		await passwordField.waitFor({ timeout: 10000, state: 'visible' })
		await passwordField.click()
		await passwordField.fill(config.personioPassword)
		await page.getByRole('button', { name: 'Fortfahren' }).click()
		console.log('[login] Credentials submitted. Waiting for response...')
		await page.waitForLoadState('domcontentloaded')
		await page.waitForTimeout(8000)
		await showState(page, config, '03-after-password')

		// Step 4: Check if login form is gone — if so, we're logged in.
		// The dashboard uses icon buttons, not text buttons, so we check
		// for the absence of the login form rather than specific UI elements.
		const loginFormStillVisible = await page.getByRole('textbox', { name: 'E-Mail-Adresse' })
			.isVisible().catch(() => false)

		if (!loginFormStillVisible) {
			console.log()
			console.log('[login] Login successful! Session saved.')
			await showState(page, config, '04-success')
			return
		}

		// Login form still visible — credentials might be wrong
		console.log()
		console.log('[login] Login form still visible after submitting credentials.')
		console.log('[login] Check the screenshot — credentials may be incorrect.')
		await showState(page, config, '04-login-failed')
	} finally {
		console.log()
		console.log('[login] Closing browser. Session has been saved to the persistent profile.')
		await context.close().catch(() => {})
	}
}

main().catch((error: unknown) => {
	console.error('[login] Fatal error:', error instanceof Error ? error.message : error)
	process.exit(1)
})
