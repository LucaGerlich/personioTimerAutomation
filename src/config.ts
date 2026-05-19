import 'dotenv/config'
import type { AppConfig } from './types.ts'

/**
 * Reads an optional environment variable with a default fallback.
 */
function optionalEnv(name: string, fallback: string): string {
	return process.env[name] || fallback
}

/**
 * Validates and returns the application configuration.
 * Fails fast at startup if any required variable is missing.
 */
export function loadConfig(): AppConfig {
	const missing: string[] = []
	const requireEnv = (name: string): string => {
		const value = process.env[name]
		if (!value) missing.push(name)
		return value ?? ''
	}

	const triggerToken = requireEnv('TRIGGER_TOKEN')
	const personioUrl = requireEnv('PERSONIO_URL')
	const personioEmail = requireEnv('PERSONIO_EMAIL')
	const personioPassword = requireEnv('PERSONIO_PASSWORD')

	if (missing.length > 0) {
		throw new Error(
			`Missing required environment variables:\n${missing.map((v) => `  - ${v}`).join('\n')}\n\nCopy .env.example to .env and fill in all values.`
		)
	}

	const port = parseInt(optionalEnv('PORT', '3000'), 10)
	const cooldownMinutes = parseInt(optionalEnv('COOLDOWN_MINUTES', '15'), 10)
	const allowedStartHour = parseInt(optionalEnv('ALLOWED_START_HOUR', '5'), 10)
	const allowedEndHour = parseInt(optionalEnv('ALLOWED_END_HOUR', '12'), 10)
	const breakStartHour = parseInt(optionalEnv('BREAK_START_HOUR', '12'), 10)
	const breakEndHour = parseInt(optionalEnv('BREAK_END_HOUR', '14'), 10)
	const headless = optionalEnv('HEADLESS', 'true') === 'true'
	const timezone = optionalEnv('TIMEZONE', 'Europe/Berlin')

	const storagePath = optionalEnv('STORAGE_PATH', '/app/storage')
	const browserProfilePath = `${storagePath}/personio-browser-profile`
	const screenshotPath = `${storagePath}/screenshots`

	return {
		port,
		triggerToken,
		personioUrl,
		personioEmail,
		personioPassword,
		headless,
		cooldownMinutes,
		allowedStartHour,
		allowedEndHour,
		breakStartHour,
		breakEndHour,
		timezone,
		storagePath,
		browserProfilePath,
		screenshotPath,
	}
}
