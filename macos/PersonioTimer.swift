import AppKit
import Foundation

// MARK: - Config

struct Config {
	let triggerURL: String
	let triggerToken: String
	let breakStartHour: Int
	let breakEndHour: Int

	static func load(from path: String) -> Config? {
		guard let content = try? String(contentsOfFile: path, encoding: .utf8) else {
			print("[config] ERROR: Cannot read config file: \(path)")
			return nil
		}

		var values: [String: String] = [:]
		for line in content.components(separatedBy: "\n") {
			let trimmed = line.trimmingCharacters(in: .whitespaces)
			if trimmed.isEmpty || trimmed.hasPrefix("#") { continue }
			let parts = trimmed.split(separator: "=", maxSplits: 1)
			if parts.count == 2 {
				let key = String(parts[0]).trimmingCharacters(in: .whitespaces)
				var value = String(parts[1]).trimmingCharacters(in: .whitespaces)
				// Remove surrounding quotes
				if (value.hasPrefix("\"") && value.hasSuffix("\"")) ||
				   (value.hasPrefix("'") && value.hasSuffix("'")) {
					value = String(value.dropFirst().dropLast())
				}
				values[key] = value
			}
		}

		guard let url = values["TRIGGER_URL"], let token = values["TRIGGER_TOKEN"] else {
			print("[config] ERROR: TRIGGER_URL and TRIGGER_TOKEN are required in config.env")
			return nil
		}

		return Config(
			triggerURL: url,
			triggerToken: token,
			breakStartHour: Int(values["BREAK_START_HOUR"] ?? "12") ?? 12,
			breakEndHour: Int(values["BREAK_END_HOUR"] ?? "14") ?? 14
		)
	}
}

// MARK: - API Client

enum TimerAction: String, CaseIterable {
	case start, `break`, resume, stop

	var displayName: String {
		switch self {
		case .start: return "Start Timer"
		case .break: return "Break"
		case .resume: return "Resume"
		case .stop: return "Stop Timer"
		}
	}

	var emoji: String {
		switch self {
		case .start: return "▶"
		case .break: return "⏸"
		case .resume: return "▶"
		case .stop: return "⏹"
		}
	}
}

struct APIResponse: Decodable {
	let status: String
	let message: String
}

func triggerAction(_ action: TimerAction, config: Config, completion: @escaping (Result<APIResponse, Error>) -> Void) {
	let urlString = "\(config.triggerURL)/trigger/\(action.rawValue)"
	guard let url = URL(string: urlString) else {
		completion(.failure(NSError(domain: "PersonioTimer", code: -1, userInfo: [NSLocalizedDescriptionKey: "Invalid URL"])))
		return
	}

	var request = URLRequest(url: url)
	request.httpMethod = "POST"
	request.setValue("Bearer \(config.triggerToken)", forHTTPHeaderField: "Authorization")
	request.timeoutInterval = 60

	URLSession.shared.dataTask(with: request) { data, response, error in
		if let error = error {
			completion(.failure(error))
			return
		}

		guard let data = data else {
			completion(.failure(NSError(domain: "PersonioTimer", code: -2, userInfo: [NSLocalizedDescriptionKey: "Empty response"])))
			return
		}

		do {
			let apiResponse = try JSONDecoder().decode(APIResponse.self, from: data)
			completion(.success(apiResponse))
		} catch {
			let body = String(data: data, encoding: .utf8) ?? "unreadable"
			completion(.failure(NSError(domain: "PersonioTimer", code: -3, userInfo: [NSLocalizedDescriptionKey: "Parse error: \(body)"])))
		}
	}.resume()
}

// MARK: - App Delegate

class AppDelegate: NSObject, NSApplicationDelegate {
	private var statusItem: NSStatusItem!
	private var statusMenuItem: NSMenuItem!
	private var autoResumeMenuItem: NSMenuItem!
	private var autoResumeEnabled = true
	private var lastActionTime: Date?
	private var lastActionResult: String?
	private var config: Config!
	private let cooldownSeconds: TimeInterval = 300 // 5 minutes

	func applicationDidFinishLaunching(_ notification: Notification) {
		// Resolve config path relative to the executable
		let executablePath = ProcessInfo.processInfo.arguments[0]
		let executableDir = (executablePath as NSString).deletingLastPathComponent
		// Try multiple config locations
		let configPaths = [
			"\(executableDir)/config.env",
			"\(executableDir)/../Resources/config.env",
			"\(executableDir)/../../macos/config.env",
			// Fallback: next to the .app bundle
			"\(executableDir)/../../../config.env",
		]

		var loadedConfig: Config?
		for path in configPaths {
			let resolved = (path as NSString).standardizingPath
			if FileManager.default.fileExists(atPath: resolved) {
				loadedConfig = Config.load(from: resolved)
				if loadedConfig != nil {
					print("[app] Loaded config from: \(resolved)")
					break
				}
			}
		}

		guard let cfg = loadedConfig else {
			let alert = NSAlert()
			alert.messageText = "Configuration Error"
			alert.informativeText = "Could not find or parse config.env.\nSearched:\n\(configPaths.joined(separator: "\n"))\n\nCopy config.env.example to config.env and fill in your values."
			alert.alertStyle = .critical
			alert.runModal()
			NSApp.terminate(nil)
			return
		}
		self.config = cfg

		setupMenuBar()
		setupScreenWakeObserver()

		print("[app] Personio Timer menu bar app started")
		print("[app] Auto-resume on screen unlock: enabled")
		print("[app] Break window: \(config.breakStartHour):00 - \(config.breakEndHour):00")
	}

	// MARK: - Menu Bar

	private func setupMenuBar() {
		statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)

		if let button = statusItem.button {
			button.title = "⏱"
		}

		let menu = NSMenu()

		// Action buttons
		for action in TimerAction.allCases {
			let item = NSMenuItem(title: "\(action.emoji)  \(action.displayName)", action: #selector(handleAction(_:)), keyEquivalent: "")
			item.target = self
			item.representedObject = action
			menu.addItem(item)
		}

		menu.addItem(NSMenuItem.separator())

		// Status line
		statusMenuItem = NSMenuItem(title: "No actions yet", action: nil, keyEquivalent: "")
		statusMenuItem.isEnabled = false
		menu.addItem(statusMenuItem)

		menu.addItem(NSMenuItem.separator())

		// Auto-resume toggle
		autoResumeMenuItem = NSMenuItem(title: "Auto-Resume on Unlock", action: #selector(toggleAutoResume), keyEquivalent: "")
		autoResumeMenuItem.target = self
		autoResumeMenuItem.state = .on
		menu.addItem(autoResumeMenuItem)

		menu.addItem(NSMenuItem.separator())

		// Quit
		let quitItem = NSMenuItem(title: "Quit", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
		menu.addItem(quitItem)

		statusItem.menu = menu
	}

	// MARK: - Actions

	@objc private func handleAction(_ sender: NSMenuItem) {
		guard let action = sender.representedObject as? TimerAction else { return }
		performAction(action, source: "manual")
	}

	private func performAction(_ action: TimerAction, source: String) {
		// Update UI to show loading
		DispatchQueue.main.async {
			self.statusMenuItem.title = "⏳ \(action.displayName)..."
			self.statusItem.button?.title = "⏳"
		}

		print("[app] Triggering \(action.rawValue) (source: \(source))")

		triggerAction(action, config: config) { [weak self] result in
			guard let self = self else { return }

			DispatchQueue.main.async {
				self.lastActionTime = Date()

				switch result {
				case .success(let response):
					print("[app] Response: \(response.status) — \(response.message)")
					self.lastActionResult = "\(action.emoji) \(response.status)"
					self.statusMenuItem.title = "✓ \(response.status)"
					self.statusItem.button?.title = "⏱"

				case .failure(let error):
					print("[app] Error: \(error.localizedDescription)")
					self.lastActionResult = "✗ \(action.rawValue) failed"
					self.statusMenuItem.title = "✗ Failed: \(error.localizedDescription.prefix(40))"
					self.statusItem.button?.title = "⚠"

					// Reset icon after 10 seconds
					DispatchQueue.main.asyncAfter(deadline: .now() + 10) {
						self.statusItem.button?.title = "⏱"
					}
				}
			}
		}
	}

	// MARK: - Auto-Resume Toggle

	@objc private func toggleAutoResume() {
		autoResumeEnabled.toggle()
		autoResumeMenuItem.state = autoResumeEnabled ? .on : .off
		print("[app] Auto-resume on unlock: \(autoResumeEnabled ? "enabled" : "disabled")")
	}

	// MARK: - Screen Wake Detection

	private func setupScreenWakeObserver() {
		let center = NSWorkspace.shared.notificationCenter

		// Screen unlock / wake from sleep
		center.addObserver(
			forName: NSWorkspace.screensDidWakeNotification,
			object: nil,
			queue: .main
		) { [weak self] _ in
			self?.handleScreenWake()
		}

		// Also observe session becoming active (unlocking the screen)
		center.addObserver(
			forName: NSWorkspace.sessionDidBecomeActiveNotification,
			object: nil,
			queue: .main
		) { [weak self] _ in
			self?.handleScreenWake()
		}
	}

	private func handleScreenWake() {
		guard autoResumeEnabled else {
			print("[app] Screen woke but auto-resume is disabled")
			return
		}

		// Check if within break window
		let hour = Calendar.current.component(.hour, from: Date())
		guard hour >= config.breakStartHour && hour < config.breakEndHour else {
			print("[app] Screen woke but outside break window (\(hour):xx, window: \(config.breakStartHour)-\(config.breakEndHour))")
			return
		}

		// Check weekday
		let weekday = Calendar.current.component(.weekday, from: Date())
		guard weekday >= 2 && weekday <= 6 else {
			print("[app] Screen woke but it's a weekend")
			return
		}

		// Check cooldown
		if let lastTime = lastActionTime {
			let elapsed = Date().timeIntervalSince(lastTime)
			if elapsed < cooldownSeconds {
				print("[app] Screen woke but cooldown active (\(Int(cooldownSeconds - elapsed))s remaining)")
				return
			}
		}

		print("[app] Screen unlocked during break window — auto-resuming")
		performAction(.resume, source: "screen-unlock")
	}
}

// MARK: - Main

let app = NSApplication.shared
app.setActivationPolicy(.accessory) // No dock icon
let delegate = AppDelegate()
app.delegate = delegate
app.run()
