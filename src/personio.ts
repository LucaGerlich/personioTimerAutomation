import { chromium, type BrowserContext, type Page } from 'playwright'
import { mkdirSync } from 'node:fs'
import type { AppConfig, TriggerStatus } from './types.ts'

// ============================================================================
// SELECTOR CONFIGURATION
//
// Captured via `npx playwright codegen`. If Personio changes their UI,
// re-run codegen and update these values.
// ============================================================================

const SELECTORS = {
	// --- Login page (two-step flow: email → continue → password → continue) ---
	emailInput: 'E-Mail-Adresse',
	passwordInput: 'Passwort',
	continueButton: 'Fortfahren',

	// --- Timer controls ---
	startTimerButton: 'Arbeitsbeginn erfassen',
	// When the timer is running, the button text changes to end/pause work
	timerRunningIndicator: /Arbeitsende erfassen|Pause/i,

	// --- Login state detection ---
	// The start-timer button itself is a reliable logged-in indicator
	loggedInIndicator: /Arbeitsbeginn erfassen|Arbeitsende erfassen|Pause/i,

	// --- MFA/2FA detection ---
	mfaIndicator: /two.factor|2fa|mfa|verification\s*code|bestätigungscode|authenticator/i,
} as const

/**
 * Launches a persistent Chromium browser context.
 * The user-data directory is mounted as a Docker volume so sessions survive restarts.
 */
export async function launchBrowser(config: AppConfig): Promise<BrowserContext> {
	mkdirSync(config.browserProfilePath, { recursive: true })

	const context = await chromium.launchPersistentContext(config.browserProfilePath, {
		headless: config.headless,
		args: [
			'--no-sandbox',
			'--disable-setuid-sandbox',
			'--disable-dev-shm-usage',
			'--disable-gpu',
		],
		viewport: { width: 1280, height: 720 },
		locale: 'de-DE',
		timezoneId: config.timezone,
	})

	return context
}

/**
 * Launches a browser context with remote debugging enabled for manual login.
 * Connect from your browser at http://HOST:9222 to interact with the Chromium instance.
 */
export async function launchBrowserForLogin(config: AppConfig): Promise<BrowserContext> {
	mkdirSync(config.browserProfilePath, { recursive: true })

	const context = await chromium.launchPersistentContext(config.browserProfilePath, {
		headless: false,
		args: [
			'--no-sandbox',
			'--disable-setuid-sandbox',
			'--disable-dev-shm-usage',
			'--remote-debugging-port=9222',
			'--remote-debugging-address=0.0.0.0',
		],
		viewport: { width: 1280, height: 720 },
		locale: 'de-DE',
		timezoneId: config.timezone,
	})

	return context
}

/**
 * Checks whether the user is currently logged in to Personio.
 * Uses the presence of the timer button (start or stop) as the indicator.
 */
async function isLoggedIn(page: Page): Promise<boolean> {
	try {
		const indicator = page.getByRole('button', { name: SELECTORS.loggedInIndicator })
		await indicator.waitFor({ timeout: 5000, state: 'visible' })
		return true
	} catch {
		return false
	}
}

/**
 * Detects whether Personio is showing a 2FA/MFA challenge.
 */
async function isMfaRequired(page: Page): Promise<boolean> {
	try {
		const mfaElement = page.getByText(SELECTORS.mfaIndicator).first()
		await mfaElement.waitFor({ timeout: 3000, state: 'visible' })
		return true
	} catch {
		return false
	}
}

/**
 * Logs in to Personio using the two-step flow:
 *   1. Enter email → click "Fortfahren"
 *   2. Enter password → click "Fortfahren"
 *
 * If MFA is detected at any point, throws with instructions for manual login.
 */
export async function loginIfNeeded(page: Page, config: AppConfig): Promise<void> {
	console.log('[personio] Navigating to Personio...')
	await page.goto(config.personioUrl, { waitUntil: 'domcontentloaded' })
	await page.waitForTimeout(3000)

	if (await isLoggedIn(page)) {
		console.log('[personio] Already logged in.')
		return
	}

	console.log('[personio] Not logged in. Attempting login...')

	// Check for MFA before attempting credentials
	if (await isMfaRequired(page)) {
		throw new Error(
			'MFA/2FA detected. Please complete login manually using: npm run login'
		)
	}

	// Step 1: Enter email and continue
	const emailField = page.getByRole('textbox', { name: SELECTORS.emailInput })
	await emailField.waitFor({ timeout: 10000, state: 'visible' })
	await emailField.click()
	await emailField.fill(config.personioEmail)

	const continueBtn = page.getByRole('button', { name: SELECTORS.continueButton })
	await continueBtn.click()
	console.log('[personio] Email entered, continuing...')

	// Step 2: Enter password and continue
	const passwordField = page.getByRole('textbox', { name: SELECTORS.passwordInput })
	await passwordField.waitFor({ timeout: 10000, state: 'visible' })
	await passwordField.click()
	await passwordField.fill(config.personioPassword)

	await page.getByRole('button', { name: SELECTORS.continueButton }).click()
	console.log('[personio] Password entered, logging in...')

	// Wait for post-login navigation
	await page.waitForLoadState('domcontentloaded')
	await page.waitForTimeout(5000)

	// Check for MFA after submitting credentials
	if (await isMfaRequired(page)) {
		throw new Error(
			'MFA/2FA required after login. Please complete login manually using: npm run login'
		)
	}

	if (!(await isLoggedIn(page))) {
		throw new Error('Login failed. Check credentials or complete login manually using: npm run login')
	}

	console.log('[personio] Login successful.')
}

/**
 * Ensures the page showing the timer button is loaded.
 * The "Arbeitsbeginn erfassen" button appears on the Personio dashboard
 * after login, so explicit navigation may not be necessary. If the button
 * isn't visible, we try the attendance URL as a fallback.
 */
export async function openTimeTracking(page: Page, config: AppConfig): Promise<void> {
	console.log('[personio] Checking if timer button is already visible...')

	// The button may already be visible after login/page load
	try {
		const startBtn = page.getByRole('button', { name: SELECTORS.startTimerButton })
		await startBtn.waitFor({ timeout: 5000, state: 'visible' })
		console.log('[personio] Timer button found on current page.')
		return
	} catch {
		// Not visible — try navigating to attendance page
	}

	// Also check if timer is already running (stop button visible)
	try {
		const stopBtn = page.getByRole('button', { name: SELECTORS.timerRunningIndicator })
		await stopBtn.waitFor({ timeout: 2000, state: 'visible' })
		console.log('[personio] Timer already running (stop button visible).')
		return
	} catch {
		// Not visible — navigate to attendance page
	}

	console.log('[personio] Navigating to attendance page...')
	const attendanceUrl = `${config.personioUrl}/attendance/employee/overview`
	await page.goto(attendanceUrl, { waitUntil: 'domcontentloaded' })
	await page.waitForTimeout(3000)
	console.log('[personio] On attendance page.')
}

/**
 * Checks whether the timer is already running by looking for the
 * "Arbeitsende erfassen" or "Pause" button.
 */
export async function isTimerAlreadyRunning(page: Page): Promise<boolean> {
	try {
		const stopIndicator = page.getByRole('button', { name: SELECTORS.timerRunningIndicator })
		await stopIndicator.waitFor({ timeout: 3000, state: 'visible' })
		return true
	} catch {
		return false
	}
}

/**
 * Clicks the "Arbeitsbeginn erfassen" button to start the timer.
 */
export async function startTimer(page: Page): Promise<void> {
	console.log('[personio] Looking for "Arbeitsbeginn erfassen" button...')

	const startBtn = page.getByRole('button', { name: SELECTORS.startTimerButton })
	await startBtn.waitFor({ timeout: 10000, state: 'visible' })
	await startBtn.click()

	console.log('[personio] Clicked "Arbeitsbeginn erfassen".')
	await page.waitForTimeout(3000)
}

/**
 * Verifies the timer started by checking that the stop/pause button appeared.
 */
export async function verifyTimerStarted(page: Page): Promise<boolean> {
	try {
		const runningIndicator = page.getByRole('button', { name: SELECTORS.timerRunningIndicator })
		await runningIndicator.waitFor({ timeout: 10000, state: 'visible' })
		console.log('[personio] Timer verified as running.')
		return true
	} catch {
		console.log('[personio] Could not verify timer started.')
		return false
	}
}

/**
 * Captures a screenshot for debugging purposes.
 */
export async function captureScreenshot(page: Page, config: AppConfig, name: string): Promise<string> {
	mkdirSync(config.screenshotPath, { recursive: true })
	const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
	const filepath = `${config.screenshotPath}/${name}-${timestamp}.png`
	await page.screenshot({ path: filepath, fullPage: true })
	console.log(`[personio] Screenshot saved: ${filepath}`)
	return filepath
}

/**
 * Runs the full timer-start automation sequence.
 * Returns the result status and any relevant details.
 */
export async function runTimerAutomation(config: AppConfig): Promise<{
	status: TriggerStatus
	message: string
	screenshotPath?: string
}> {
	let context: BrowserContext | null = null

	try {
		context = await launchBrowser(config)
		const page = context.pages()[0] ?? await context.newPage()

		// Step 1: Login if needed
		await loginIfNeeded(page, config)

		// Step 2: Navigate to time tracking
		await openTimeTracking(page, config)

		// Step 3: Check if timer is already running
		if (await isTimerAlreadyRunning(page)) {
			console.log('[personio] Timer is already running. Nothing to do.')
			return {
				status: 'already_started',
				message: 'Timer is already running.',
			}
		}

		// Step 4: Start the timer
		await startTimer(page)

		// Step 5: Verify it started
		const verified = await verifyTimerStarted(page)
		if (!verified) {
			const screenshotPath = await captureScreenshot(page, config, 'verify-failed')
			return {
				status: 'failed',
				message: 'Timer start could not be verified. Check screenshot.',
				screenshotPath,
			}
		}

		return {
			status: 'started',
			message: 'Timer started successfully.',
		}
	} catch (error: unknown) {
		const errorMessage = error instanceof Error ? error.message : 'Unknown error'
		console.error(`[personio] Automation failed: ${errorMessage}`)

		let screenshotPath: string | undefined
		try {
			if (context) {
				const pages = context.pages()
				if (pages.length > 0) {
					screenshotPath = await captureScreenshot(pages[0], config, 'error')
				}
			}
		} catch {
			console.error('[personio] Failed to capture error screenshot.')
		}

		return {
			status: 'failed',
			message: errorMessage,
			screenshotPath,
		}
	} finally {
		if (context) {
			await context.close().catch(() => {})
		}
	}
}
