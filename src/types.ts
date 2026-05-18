/** Possible outcomes from a trigger attempt */
export type TriggerStatus =
	| 'started'
	| 'already_started'
	| 'skipped_weekend'
	| 'skipped_outside_time_window'
	| 'skipped_cooldown'
	| 'failed'

/** Structured response from the /trigger/start endpoint */
export interface TriggerResponse {
	status: TriggerStatus
	message: string
	timestamp: string
	details?: Record<string, unknown>
}

/** Health check response */
export interface HealthResponse {
	status: 'ok'
	uptime: number
	timestamp: string
}

/** Validated application configuration */
export interface AppConfig {
	port: number
	triggerToken: string
	personioUrl: string
	personioEmail: string
	personioPassword: string
	headless: boolean
	cooldownMinutes: number
	allowedStartHour: number
	allowedEndHour: number
	timezone: string
	storagePath: string
	browserProfilePath: string
	screenshotPath: string
}
