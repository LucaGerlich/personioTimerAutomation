#!/bin/bash
# ==============================================================================
# Personio Wi-Fi Monitor for macOS
#
# Polls the current Wi-Fi SSID every 30 seconds. When the work SSID is
# detected (connect) or lost (disconnect), calls the appropriate endpoint
# on the Personio timer service.
#
# State is tracked via a file so it survives across launchd invocations.
# ==============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_FILE="${SCRIPT_DIR}/config.env"
# Use a fixed path for state — TMPDIR changes per launchd invocation on macOS
STATE_FILE="${HOME}/.personio-wifi-state"
LOG_PREFIX="[personio-wifi]"

# Load configuration
if [[ ! -f "$CONFIG_FILE" ]]; then
	echo "${LOG_PREFIX} ERROR: Config file not found: ${CONFIG_FILE}"
	echo "${LOG_PREFIX} Copy config.env.example to config.env and fill in your values."
	exit 1
fi

# shellcheck source=/dev/null
source "$CONFIG_FILE"

# Validate required config
for var in WORK_SSID TRIGGER_URL TRIGGER_TOKEN; do
	if [[ -z "${!var:-}" ]]; then
		echo "${LOG_PREFIX} ERROR: ${var} is not set in ${CONFIG_FILE}"
		exit 1
	fi
done

BREAK_START_HOUR="${BREAK_START_HOUR:-12}"
BREAK_END_HOUR="${BREAK_END_HOUR:-14}"

# Get the current Wi-Fi SSID (empty string if not connected)
get_current_ssid() {
	local ssid
	ssid=$(networksetup -getairportnetwork en0 2>/dev/null | grep "Current Wi-Fi Network:" | sed 's/Current Wi-Fi Network: //')
	echo "$ssid"
}

# Get the current hour in local time
get_current_hour() {
	date +%H | sed 's/^0//'
}

# Read the previous state (returns "connected" or "disconnected")
get_previous_state() {
	if [[ -f "$STATE_FILE" ]]; then
		cat "$STATE_FILE"
	else
		echo "unknown"
	fi
}

# Save the current state
save_state() {
	echo "$1" > "$STATE_FILE"
}

# Call the trigger endpoint
trigger() {
	local action="$1"
	local url="${TRIGGER_URL}/trigger/${action}"

	echo "${LOG_PREFIX} $(date '+%Y-%m-%d %H:%M:%S') Triggering: ${action}"

	local http_code
	local body
	body=$(curl -s -o /dev/stderr -w "%{http_code}" -X POST \
		-H "Authorization: Bearer ${TRIGGER_TOKEN}" \
		"$url" 2>&1)
	http_code="$body"

	# Simpler approach: just log the full response
	local response
	response=$(curl -s -X POST \
		-H "Authorization: Bearer ${TRIGGER_TOKEN}" \
		"$url" 2>&1)

	echo "${LOG_PREFIX} Response: ${response}"
}

# Main logic
main() {
	local current_ssid
	current_ssid=$(get_current_ssid)

	local previous_state
	previous_state=$(get_previous_state)

	local current_state
	if [[ "$current_ssid" == "$WORK_SSID" ]]; then
		current_state="connected"
	else
		current_state="disconnected"
	fi

	# No state change — nothing to do
	if [[ "$current_state" == "$previous_state" ]]; then
		return
	fi

	echo "${LOG_PREFIX} $(date '+%Y-%m-%d %H:%M:%S') Wi-Fi state changed: ${previous_state} → ${current_state} (SSID: ${current_ssid:-none})"

	local hour
	hour=$(get_current_hour)

	if [[ "$current_state" == "connected" ]]; then
		# Connected to work Wi-Fi
		if (( hour >= BREAK_START_HOUR && hour < BREAK_END_HOUR )); then
			trigger "resume"
		else
			trigger "start"
		fi
	else
		# Disconnected from work Wi-Fi
		if (( hour >= BREAK_START_HOUR && hour < BREAK_END_HOUR )); then
			trigger "break"
		else
			trigger "stop"
		fi
	fi

	save_state "$current_state"
}

main
