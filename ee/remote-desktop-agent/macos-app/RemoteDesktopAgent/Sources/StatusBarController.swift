import AppKit
import SwiftUI

/// Controls the menu bar status item for the Remote Desktop Agent
///
/// This provides a persistent menu bar icon that shows:
/// - Current connection status
/// - Quick access to controls (connect/disconnect, settings)
/// - Permission status
/// - Active session information
final class StatusBarController {
    private var statusItem: NSStatusItem
    private var menu: NSMenu
    private weak var agentController: AgentController?

    // Menu items that need to be updated
    private var statusMenuItem: NSMenuItem!
    private var connectionMenuItem: NSMenuItem!
    private var activeSessionMenuItem: NSMenuItem!
    private var permissionMenuItem: NSMenuItem!

    init(agentController: AgentController) {
        self.agentController = agentController

        // Create status bar item
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)

        // Set up the icon
        if let button = statusItem.button {
            button.image = NSImage(systemSymbolName: "desktopcomputer", accessibilityDescription: "Remote Desktop")
            button.image?.isTemplate = true
        }

        // Create menu
        menu = NSMenu()
        setupMenu()
        statusItem.menu = menu

        // Observe agent status changes
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(updateStatus),
            name: .agentStatusChanged,
            object: nil
        )
    }

    private func setupMenu() {
        // Status display
        statusMenuItem = NSMenuItem(title: "Status: Disconnected", action: nil, keyEquivalent: "")
        statusMenuItem.isEnabled = false
        menu.addItem(statusMenuItem)

        // Active session display (hidden by default)
        activeSessionMenuItem = NSMenuItem(title: "", action: nil, keyEquivalent: "")
        activeSessionMenuItem.isEnabled = false
        activeSessionMenuItem.isHidden = true
        menu.addItem(activeSessionMenuItem)

        menu.addItem(NSMenuItem.separator())

        // Connection toggle
        connectionMenuItem = NSMenuItem(title: "Connect", action: #selector(toggleConnection), keyEquivalent: "c")
        connectionMenuItem.target = self
        menu.addItem(connectionMenuItem)

        menu.addItem(NSMenuItem.separator())

        // Permission status
        permissionMenuItem = NSMenuItem(title: "Permissions: Checking...", action: #selector(openPermissions), keyEquivalent: "")
        permissionMenuItem.target = self
        menu.addItem(permissionMenuItem)
        updatePermissionStatus()

        menu.addItem(NSMenuItem.separator())

        // Settings
        let settingsItem = NSMenuItem(title: "Settings...", action: #selector(openSettings), keyEquivalent: ",")
        settingsItem.target = self
        menu.addItem(settingsItem)

        // About
        let aboutItem = NSMenuItem(title: "About Remote Desktop Agent", action: #selector(showAbout), keyEquivalent: "")
        aboutItem.target = self
        menu.addItem(aboutItem)

        menu.addItem(NSMenuItem.separator())

        // Quit
        let quitItem = NSMenuItem(title: "Quit", action: #selector(quit), keyEquivalent: "q")
        quitItem.target = self
        menu.addItem(quitItem)
    }

    @objc private func toggleConnection() {
        guard let agent = agentController else { return }

        if agent.isConnected {
            agent.stop()
        } else {
            Task {
                await agent.start()
            }
        }
    }

    @objc private func openSettings() {
        // Open the settings window
        NSApp.sendAction(Selector(("showSettingsWindow:")), to: nil, from: nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    @objc private func openPermissions() {
        PermissionManager.shared.openSystemPreferences()
    }

    @objc private func showAbout() {
        let alert = NSAlert()
        alert.messageText = "Remote Desktop Agent"

        let version = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "1.0"
        let build = Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "1"

        var info = "Version \(version) (\(build))\n\n"
        info += "Part of Alga PSA\n"
        info += "Provides remote desktop support capabilities.\n\n"

        if let agentInfo = agentController?.getAgentInfo() {
            info += "Agent ID: \(agentInfo.agentId)\n"
            info += "Agent Name: \(agentInfo.agentName)"
        }

        alert.informativeText = info
        alert.alertStyle = .informational
        alert.runModal()
    }

    @objc private func quit() {
        agentController?.stop()
        NSApp.terminate(nil)
    }

    @objc private func updateStatus() {
        guard let agent = agentController else { return }

        // Update status icon
        if let button = statusItem.button {
            let symbolName: String
            let color: NSColor

            switch agent.status {
            case .disconnected:
                symbolName = "desktopcomputer"
                color = .secondaryLabelColor
            case .connecting:
                symbolName = "desktopcomputer"
                color = .systemYellow
            case .connected:
                symbolName = "desktopcomputer"
                color = .systemGreen
            case .activeSession:
                symbolName = "desktopcomputer.and.arrow.down"
                color = .systemBlue
            case .error:
                symbolName = "exclamationmark.triangle"
                color = .systemRed
            }

            button.image = NSImage(systemSymbolName: symbolName, accessibilityDescription: "Remote Desktop")
            button.image?.isTemplate = false
            button.contentTintColor = color
        }

        // Update menu items
        statusMenuItem.title = "Status: \(agent.status.displayName)"

        switch agent.status {
        case .disconnected, .error:
            connectionMenuItem.title = "Connect"
        case .connecting:
            connectionMenuItem.title = "Connecting..."
            connectionMenuItem.isEnabled = false
        case .connected, .activeSession:
            connectionMenuItem.title = "Disconnect"
            connectionMenuItem.isEnabled = true
        }

        // Show/hide active session info
        if case .activeSession(let sessionId) = agent.status {
            activeSessionMenuItem.title = "Session: \(sessionId.prefix(8))..."
            activeSessionMenuItem.isHidden = false
        } else {
            activeSessionMenuItem.isHidden = true
        }
    }

    private func updatePermissionStatus() {
        let status = PermissionManager.shared.checkPermissions()

        if status.screenRecording && status.accessibility {
            permissionMenuItem.title = "✓ Permissions Granted"
            permissionMenuItem.isEnabled = false
        } else {
            var missing: [String] = []
            if !status.screenRecording { missing.append("Screen Recording") }
            if !status.accessibility { missing.append("Accessibility") }
            permissionMenuItem.title = "⚠ Missing: \(missing.joined(separator: ", "))"
            permissionMenuItem.isEnabled = true
        }
    }
}

// MARK: - Agent Status

enum AgentStatus: Equatable {
    case disconnected
    case connecting
    case connected
    case activeSession(sessionId: String)
    case error(message: String)

    var displayName: String {
        switch self {
        case .disconnected:
            return "Disconnected"
        case .connecting:
            return "Connecting..."
        case .connected:
            return "Connected"
        case .activeSession:
            return "Active Session"
        case .error(let message):
            return "Error: \(message)"
        }
    }

    static func == (lhs: AgentStatus, rhs: AgentStatus) -> Bool {
        switch (lhs, rhs) {
        case (.disconnected, .disconnected),
             (.connecting, .connecting),
             (.connected, .connected):
            return true
        case (.activeSession(let a), .activeSession(let b)):
            return a == b
        case (.error(let a), .error(let b)):
            return a == b
        default:
            return false
        }
    }
}

// MARK: - Notifications

extension Notification.Name {
    static let agentStatusChanged = Notification.Name("agentStatusChanged")
}
