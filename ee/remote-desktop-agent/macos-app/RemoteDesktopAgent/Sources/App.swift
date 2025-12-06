import SwiftUI
import AppKit

/// Remote Desktop Agent macOS Application
///
/// This SwiftUI app provides the native macOS UI wrapper around the Rust
/// remote desktop agent core. It handles:
/// - Menu bar status item with controls
/// - Permission requests (Accessibility, Screen Recording)
/// - Session consent dialogs
/// - Configuration management
@main
struct RemoteDesktopAgentApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) var appDelegate

    var body: some Scene {
        // Hidden window group - the app runs primarily from the menu bar
        Settings {
            SettingsView()
        }
    }
}

/// Application delegate for handling lifecycle and menu bar
class AppDelegate: NSObject, NSApplicationDelegate {
    private var statusBarController: StatusBarController?
    private var agentController: AgentController?

    func applicationDidFinishLaunching(_ notification: Notification) {
        // Initialize the Rust logging
        AgentBridge.initLogging()

        // Create the agent controller
        agentController = AgentController()

        // Create status bar controller
        statusBarController = StatusBarController(agentController: agentController!)

        // Hide dock icon - this is a menu bar app
        NSApp.setActivationPolicy(.accessory)

        // Check and request permissions
        Task {
            await checkPermissions()
        }

        // Start the agent if configured
        if let configPath = getConfigPath(), FileManager.default.fileExists(atPath: configPath) {
            Task {
                await agentController?.start()
            }
        }
    }

    func applicationWillTerminate(_ notification: Notification) {
        agentController?.stop()
    }

    private func checkPermissions() async {
        let permissionManager = PermissionManager.shared

        // Check current permission status
        let status = permissionManager.checkPermissions()

        if !status.screenRecording || !status.accessibility {
            // Show permission request UI
            await MainActor.run {
                showPermissionAlert(status: status)
            }
        }
    }

    private func showPermissionAlert(status: PermissionStatus) {
        let alert = NSAlert()
        alert.messageText = "Permissions Required"

        var message = "Remote Desktop Agent needs the following permissions to function:\n\n"
        if !status.screenRecording {
            message += "• Screen Recording - to share your screen\n"
        }
        if !status.accessibility {
            message += "• Accessibility - to control mouse and keyboard\n"
        }
        message += "\nClick 'Open Settings' to grant these permissions."

        alert.informativeText = message
        alert.alertStyle = .warning
        alert.addButton(withTitle: "Open Settings")
        alert.addButton(withTitle: "Later")

        let response = alert.runModal()
        if response == .alertFirstButtonReturn {
            PermissionManager.shared.openSystemPreferences()
        }
    }

    private func getConfigPath() -> String? {
        let appSupport = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
        return appSupport?.appendingPathComponent("RemoteDesktopAgent/config.json").path
    }
}

/// Settings view for the app preferences
struct SettingsView: View {
    @State private var serverUrl = ""
    @State private var agentName = ""
    @State private var autoStart = true

    var body: some View {
        Form {
            Section("Server Configuration") {
                TextField("Server URL", text: $serverUrl)
                TextField("Agent Name", text: $agentName)
            }

            Section("Startup") {
                Toggle("Start agent automatically", isOn: $autoStart)
            }

            Section("Permissions") {
                PermissionStatusView()
            }
        }
        .padding()
        .frame(width: 400, height: 300)
    }
}

/// View showing current permission status
struct PermissionStatusView: View {
    @State private var status = PermissionManager.shared.checkPermissions()

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Image(systemName: status.screenRecording ? "checkmark.circle.fill" : "xmark.circle.fill")
                    .foregroundColor(status.screenRecording ? .green : .red)
                Text("Screen Recording")
            }

            HStack {
                Image(systemName: status.accessibility ? "checkmark.circle.fill" : "xmark.circle.fill")
                    .foregroundColor(status.accessibility ? .green : .red)
                Text("Accessibility")
            }

            if !status.screenRecording || !status.accessibility {
                Button("Open System Settings") {
                    PermissionManager.shared.openSystemPreferences()
                }
                .padding(.top, 8)
            }
        }
        .onAppear {
            status = PermissionManager.shared.checkPermissions()
        }
    }
}
