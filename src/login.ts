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

import { createInterface } from 'node:readline'
import { mkdirSync } from 'node:fs'
import { loadConfig } from './config.ts'
import { launchBrowser, captureScreenshot } from './personio.ts'
import type { AppConfig } from './types.ts'
import type { Page } from 'playwright'

/**
 * Prompts the user for input via stdin.
 */
function prompt(question: string): Promise<string> {
	const rl = createInterface({ input: process.stdin, output: process.stdout })
	return new Promise((resolve) => {
		rl.question(question, (answer) => {
			rl.close()
			resolve(answer.trim())
		})
	})
}

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

		// Step 4: Check what happened — try the dashboard check with a generous timeout
		try {
			const timerBtn = page.getByRole('button', { name: /Arbeitsbeginn erfassen|Arbeitsende erfassen|Pause/i })
			await timerBtn.waitFor({ timeout: 15000, state: 'visible' })
			console.log()
			console.log('[login] Login successful! Session saved.')
			await showState(page, config, '04-success')
			return
		} catch {
			// Not on dashboard yet — might be MFA
		}

		// Check for MFA by looking for an actual MFA input field, not just page text.
		// Checking page.content() for keywords like "2fa" or "authenticator" causes
		// false positives because the dashboard HTML may contain those strings in
		// script tags, settings links, or hidden elements.
		const hasMfaInput = await page.locator('input[autocomplete="one-time-code"], input[name*="otp"], input[name*="code"], input[name*="token"], input[name*="mfa"]').count() > 0
		const hasVisibleCodePrompt = await page.getByText(/enter.*code|code eingeben|einmalpasswort/i).isVisible().catch(() => false)
		const isMfa = hasMfaInput || hasVisibleCodePrompt

		if (isMfa) {
			console.log()
			console.log('[login] MFA/2FA detected!')
			await showState(page, config, '04-mfa-detected')
			console.log()
			console.log('  Check the screenshot above to see what the page looks like.')

			const code = await prompt('  Enter the MFA code: ')

			// Try to find and fill the MFA input field
			// Common patterns: input[type=text], input[type=number], input with OTP/code label
			const mfaInput = page.locator('input[type="text"], input[type="number"], input[type="tel"]').first()
			await mfaInput.fill(code)

			// Try to submit — look for a submit/verify/continue button
			const submitBtn = page.getByRole('button', { name: /fortfahren|verify|bestätigen|submit|weiter|continue/i })
			await submitBtn.click()

			await page.waitForLoadState('domcontentloaded')
			await page.waitForTimeout(5000)
			await showState(page, config, '05-after-mfa')

			// Check if we're logged in now
			try {
				const timerBtn = page.getByRole('button', { name: /Arbeitsbeginn erfassen|Arbeitsende erfassen|Pause/i })
				await timerBtn.waitFor({ timeout: 5000, state: 'visible' })
				console.log()
				console.log('[login] Login successful after MFA! Session saved.')
				return
			} catch {
				console.log()
				console.log('[login] Still not logged in after MFA. Check the screenshot.')
				await showState(page, config, '06-mfa-failed')
			}
		} else {
			// Not MFA — something else went wrong
			console.log()
			console.log('[login] Login did not reach the dashboard.')
			console.log('[login] Check the screenshot to see what happened.')
			await showState(page, config, '04-unexpected-state')
			console.log()

			const action = await prompt('  Press Enter to take another screenshot, or type "quit" to exit: ')
			if (action !== 'quit') {
				await page.waitForTimeout(3000)
				await showState(page, config, '05-retry')
			}
		}
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
