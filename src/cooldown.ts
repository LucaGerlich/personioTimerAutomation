import type { AppConfig, PersonioAction } from './types.ts'

/** Tracks the last successful trigger timestamp per action (in-memory, resets on restart) */
const lastTriggerTimes = new Map<PersonioAction, Date>()

/**
 * Returns whether enough time has passed since the last successful trigger for the given action.
 */
export function canTrigger(config: AppConfig, action: PersonioAction): boolean {
	const lastTime = lastTriggerTimes.get(action)
	if (!lastTime) return true
	const elapsedMs = Date.now() - lastTime.getTime()
	const cooldownMs = config.cooldownMinutes * 60 * 1000
	return elapsedMs >= cooldownMs
}

/**
 * Returns how many minutes remain until the cooldown expires for the given action.
 */
export function cooldownRemainingMinutes(config: AppConfig, action: PersonioAction): number {
	const lastTime = lastTriggerTimes.get(action)
	if (!lastTime) return 0
	const elapsedMs = Date.now() - lastTime.getTime()
	const cooldownMs = config.cooldownMinutes * 60 * 1000
	const remainingMs = cooldownMs - elapsedMs
	return Math.max(0, Math.ceil(remainingMs / 60_000))
}

/**
 * Records the current time as the last successful trigger for the given action.
 */
export function recordTrigger(action: PersonioAction): void {
	lastTriggerTimes.set(action, new Date())
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
 * Returns true if the current hour falls within the break window.
 */
export function isWithinBreakWindow(config: AppConfig): boolean {
	const { hour } = getLocalTime(config.timezone)
	return hour >= config.breakStartHour && hour < config.breakEndHour
}

/**
 * Returns a human-readable summary of the current time guards state.
 */
export function getGuardStatus(config: AppConfig): {
	weekday: boolean
	withinWindow: boolean
	cooldowns: Record<PersonioAction, boolean>
	localTime: string
} {
	const { hour, dayOfWeek } = getLocalTime(config.timezone)
	const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
	const actions: PersonioAction[] = ['start', 'break', 'resume', 'stop']
	const cooldowns = Object.fromEntries(
		actions.map((a) => [a, canTrigger(config, a)])
	) as Record<PersonioAction, boolean>

	return {
		weekday: dayOfWeek >= 1 && dayOfWeek <= 5,
		withinWindow: hour >= config.allowedStartHour && hour < config.allowedEndHour,
		cooldowns,
		localTime: `${days[dayOfWeek]} ${hour}:xx (${config.timezone})`,
	}
}
