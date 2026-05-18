import type { AppConfig } from './types.ts'

/** Tracks the last successful trigger timestamp (in-memory, resets on restart) */
let lastTriggerTime: Date | null = null

/**
 * Returns whether enough time has passed since the last successful trigger.
 */
export function canTrigger(config: AppConfig): boolean {
	if (!lastTriggerTime) return true
	const elapsedMs = Date.now() - lastTriggerTime.getTime()
	const cooldownMs = config.cooldownMinutes * 60 * 1000
	return elapsedMs >= cooldownMs
}

/**
 * Returns how many minutes remain until the cooldown expires.
 */
export function cooldownRemainingMinutes(config: AppConfig): number {
	if (!lastTriggerTime) return 0
	const elapsedMs = Date.now() - lastTriggerTime.getTime()
	const cooldownMs = config.cooldownMinutes * 60 * 1000
	const remainingMs = cooldownMs - elapsedMs
	return Math.max(0, Math.ceil(remainingMs / 60_000))
}

/**
 * Records the current time as the last successful trigger.
 */
export function recordTrigger(): void {
	lastTriggerTime = new Date()
}

/**
 * Returns the current local hour and day-of-week in the configured timezone.
 */
function getLocalTime(timezone: string): { hour: number; dayOfWeek: number } {
	const now = new Date()
	const formatter = new Intl.DateTimeFormat('en-US', {
		timeZone: timezone,
		hour: 'numeric',
		hour12: false,
		weekday: 'short',
	})

	const parts = formatter.formatToParts(now)
	const hourPart = parts.find((p) => p.type === 'hour')
	const dayPart = parts.find((p) => p.type === 'weekday')

	const hour = parseInt(hourPart?.value ?? '0', 10)
	const weekdayMap: Record<string, number> = {
		Sun: 0,
		Mon: 1,
		Tue: 2,
		Wed: 3,
		Thu: 4,
		Fri: 5,
		Sat: 6,
	}
	const dayOfWeek = weekdayMap[dayPart?.value ?? 'Mon'] ?? 1

	return { hour, dayOfWeek }
}

/**
 * Returns true if today is a weekday (Monday-Friday) in the configured timezone.
 */
export function isWeekday(config: AppConfig): boolean {
	const { dayOfWeek } = getLocalTime(config.timezone)
	return dayOfWeek >= 1 && dayOfWeek <= 5
}

/**
 * Returns true if the current hour falls within the allowed start/end window.
 */
export function isWithinTimeWindow(config: AppConfig): boolean {
	const { hour } = getLocalTime(config.timezone)
	return hour >= config.allowedStartHour && hour < config.allowedEndHour
}

/**
 * Returns a human-readable summary of the current time guards state.
 */
export function getGuardStatus(config: AppConfig): {
	weekday: boolean
	withinWindow: boolean
	cooldownClear: boolean
	localTime: string
} {
	const { hour, dayOfWeek } = getLocalTime(config.timezone)
	const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
	return {
		weekday: dayOfWeek >= 1 && dayOfWeek <= 5,
		withinWindow: hour >= config.allowedStartHour && hour < config.allowedEndHour,
		cooldownClear: canTrigger(config),
		localTime: `${days[dayOfWeek]} ${hour}:xx (${config.timezone})`,
	}
}
