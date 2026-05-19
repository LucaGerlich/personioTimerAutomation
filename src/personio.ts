import { chromium, type BrowserContext, type Page } from 'playwright'
import { mkdirSync } from 'node:fs'
import type { AppConfig, PersonioAction, TriggerStatus } from './types.ts'

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
	stopTimerButton: 'Arbeitsende erfassen',
	breakButton: 'Pause machen',
	resumeButton: 'Weiterarbeiten',

	// --- MFA/2FA detection ---
	mfaIndicator: /two.factor|2fa|mfa|verification\s*code|bestätigungscode|authenticator/i,
} as const

/**
 * Action definitions: maps each action to its button, pre-condition, and result statuses.
 */
interface ActionDef {
	buttonSelector: string
	successStatus: TriggerStatus
	alreadyDoneStatus: TriggerStatus
	/** Returns true if the action was already performed (e.g., timer already running) */
	isAlreadyDone: (page: Page) => Promise<boolean>
	/** Returns true if the action succeeded after clicking */
	verifySuccess: (page: Page) => Promise<boolean>
}

function getActionDef(action: PersonioAction): ActionDef {
	switch (action) {
		case 'start':
			return {
				buttonSelector: SELECTORS.startTimerButton,
				successStatus: 'started',
				alreadyDoneStatus: 'already_started',
				isAlreadyDone: async (page) => {
					// If start button is NOT visible but stop/break IS → already started
					const startVisible = await page.getByRole('button', { name: SELECTORS.startTimerButton })
						.isVisible().catch(() => false)
					if (startVisible) return false
					const stopVisible = await page.getByRole('button', { name: SELECTORS.stopTimerButton })
						.isVisible().catch(() => false)
					const breakVisible = await page.getByRole('button', { name: SELECTORS.breakButton })
						.isVisible().catch(() => false)
					return stopVisible || breakVisible
				},
				verifySuccess: async (page) => {
					const startGone = !(await page.getByRole('button', { name: SELECTORS.startTimerButton })
						.isVisible().catch(() => false))
					return startGone
				},
			}
		case 'break':
			return {
				buttonSelector: SELECTORS.breakButton,
				successStatus: 'break_started',
				alreadyDoneStatus: 'already_on_break',
				isAlreadyDone: async (page) => {
					// If resume button is visible → already on break
					return page.getByRole('button', { name: SELECTORS.resumeButton })
						.isVisible().catch(() => false)
				},
				verifySuccess: async (page) => {
					// Resume button should appear after starting break
					return page.getByRole('button', { name: SELECTORS.resumeButton })
						.isVisible().catch(() => false)
				},
			}
		case 'resume':
			return {
				buttonSelector: SELECTORS.resumeButton,
				successStatus: 'resumed',
				alreadyDoneStatus: 'already_working',
				isAlreadyDone: async (page) => {
					// If break button is visible → already working (not on break)
					return page.getByRole('button', { name: SELECTORS.breakButton })
						.isVisible().catch(() => false)
				},
				verifySuccess: async (page) => {
					// Break button should reappear after resuming
					return page.getByRole('button', { name: SELECTORS.breakButton })
						.isVisible().catch(() => false)
				},
			}
		case 'stop':
			return {
				buttonSelector: SELECTORS.stopTimerButton,
				successStatus: 'stopped',
				alreadyDoneStatus: 'already_stopped',
				isAlreadyDone: async (page) => {
					// If start button is visible → already stopped (timer not running)
					return page.getByRole('button', { name: SELECTORS.startTimerButton })
						.isVisible().catch(() => false)
				},
				verifySuccess: async (page) => {
					// Start button should reappear after stopping
					return page.getByRole('button', { name: SELECTORS.startTimerButton })
						.isVisible().catch(() => false)
				},
			}
	}
}

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
 * Checks whether the user is currently logged in to Personio.
 * Detects login by the ABSENCE of the login form — if the email field
 * isn't visible, we're authenticated.
 */
async function isLoggedIn(page: Page): Promise<boolean> {
	const emailField = page.getByRole('textbox', { name: 'E-Mail-Adresse' })
	const loginFormVisible = await emailField.isVisible().catch(() => false)
	return !loginFormVisible
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

	if (await isMfaRequired(page)) {
		throw new Error('MFA/2FA detected. Please complete login manually using: npm run login')
	}

	const emailField = page.getByRole('textbox', { name: SELECTORS.emailInput })
	await emailField.waitFor({ timeout: 10000, state: 'visible' })
	await emailField.click()
	await emailField.fill(config.personioEmail)

	await page.getByRole('button', { name: SELECTORS.continueButton }).click()
	console.log('[personio] Email entered, continuing...')

	const passwordField = page.getByRole('textbox', { name: SELECTORS.passwordInput })
	await passwordField.waitFor({ timeout: 10000, state: 'visible' })
	await passwordField.click()
	await passwordField.fill(config.personioPassword)

	await page.getByRole('button', { name: SELECTORS.continueButton }).click()
	console.log('[personio] Password entered, logging in...')

	await page.waitForLoadState('domcontentloaded')
	await page.waitForTimeout(5000)

	if (await isMfaRequired(page)) {
		throw new Error('MFA/2FA required after login. Please complete login manually using: npm run login')
	}

	if (!(await isLoggedIn(page))) {
		throw new Error('Login failed. Check credentials or complete login manually using: npm run login')
	}

	console.log('[personio] Login successful.')
}

/**
 * Navigates to the attendance page where the timer controls live.
 */
export async function openTimeTracking(page: Page, config: AppConfig): Promise<void> {
	// Quick check: any timer button already visible?
	for (const sel of [SELECTORS.startTimerButton, SELECTORS.stopTimerButton, SELECTORS.breakButton, SELECTORS.resumeButton]) {
		const visible = await page.getByRole('button', { name: sel }).isVisible().catch(() => false)
		if (visible) {
			console.log('[personio] Timer controls found on current page.')
			return
		}
	}

	console.log('[personio] Navigating to attendance page...')
	const attendanceUrl = `${config.personioUrl}/attendance/employee/overview`
	await page.goto(attendanceUrl, { waitUntil: 'domcontentloaded' })
	await page.waitForTimeout(5000)
	console.log('[personio] On attendance page.')
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
 * Generic automation runner for all four actions (start, break, resume, stop).
 * Handles login, navigation, pre-condition check, button click, and verification.
 */
export async function runAction(config: AppConfig, action: PersonioAction): Promise<{
	status: TriggerStatus
	message: string
	screenshotPath?: string
}> {
	const actionDef = getActionDef(action)
	let context: BrowserContext | null = null

	try {
		context = await launchBrowser(config)
		const page = context.pages()[0] ?? await context.newPage()

		// Step 1: Login if needed
		await loginIfNeeded(page, config)

		// Step 2: Navigate to time tracking
		await openTimeTracking(page, config)

		// Step 3: Check if action was already performed
		if (await actionDef.isAlreadyDone(page)) {
			console.log(`[personio] Action "${action}" already done. Nothing to do.`)
			return {
				status: actionDef.alreadyDoneStatus,
				message: `Action "${action}" was already performed.`,
			}
		}

		// Step 4: Click the button
		console.log(`[personio] Looking for "${actionDef.buttonSelector}" button...`)
		const btn = page.getByRole('button', { name: actionDef.buttonSelector })
		await btn.waitFor({ timeout: 10000, state: 'visible' })
		await btn.click()
		console.log(`[personio] Clicked "${actionDef.buttonSelector}".`)
		await page.waitForTimeout(3000)

		// Step 5: Verify success
		const verified = await actionDef.verifySuccess(page)
		if (!verified) {
			const screenshotPath = await captureScreenshot(page, config, `${action}-verify-failed`)
			return {
				status: 'failed',
				message: `Action "${action}" could not be verified. Check screenshot.`,
				screenshotPath,
			}
		}

		return {
			status: actionDef.successStatus,
			message: `Action "${action}" completed successfully.`,
		}
	} catch (error: unknown) {
		const errorMessage = error instanceof Error ? error.message : 'Unknown error'
		console.error(`[personio] Automation failed: ${errorMessage}`)

		let screenshotPath: string | undefined
		try {
			if (context) {
				const pages = context.pages()
				if (pages.length > 0) {
					screenshotPath = await captureScreenshot(pages[0], config, `${action}-error`)
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
