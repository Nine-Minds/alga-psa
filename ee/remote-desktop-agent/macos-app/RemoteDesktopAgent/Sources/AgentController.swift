import Foundation
import AppKit

/// High-level controller for the Remote Desktop Agent
///
/// This class manages the agent lifecycle, including:
/// - Configuration loading/saving
/// - Connection management
/// - Session handling with user consent
/// - Status updates
final class AgentController: ObservableObject {
    /// Current agent status
    @Published private(set) var status: AgentStatus = .disconnected

    /// Whether the agent is connected
    var isConnected: Bool {
        if case .connected = status { return true }
        if case .activeSession = status { return true }
        return false
    }

    private var bridge: AgentBridge?
    private var config: AgentConfig?
    private var pendingSessionRequest: (sessionId: String, engineerId: String)?

    init() {
        loadConfig()
    }

    // MARK: - Configuration

    private var configPath: String {
        let appSupport = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
        return appSupport.appendingPathComponent("RemoteDesktopAgent/config.json").path
    }

    private func loadConfig() {
        config = AgentConfig.load(from: configPath)
    }

    func saveConfig(_ config: AgentConfig) {
        self.config = config
        _ = config.save(to: configPath)
    }

    // MARK: - Agent Lifecycle

    /// Start the agent and connect to the server
    func start() async {
        guard let config = config else {
            updateStatus(.error(message: "No configuration"))
            return
        }

        // Check permissions first
        let permissions = PermissionManager.shared.checkPermissions()
        if !permissions.screenRecording || !permissions.accessibility {
            updateStatus(.error(message: "Missing permissions"))
            await MainActor.run {
                PermissionManager.shared.showPermissionExplanation()
            }
            return
        }

        updateStatus(.connecting)

        // Create the agent bridge
        guard let bridge = AgentBridge(config: config) else {
            updateStatus(.error(message: "Failed to initialize agent"))
            return
        }

        self.bridge = bridge

        // Connect to signaling server
        let connected = bridge.connect { [weak self] event in
            self?.handleSignalingEvent(event)
        }

        if connected {
            updateStatus(.connected)
        } else {
            updateStatus(.error(message: "Connection failed"))
        }
    }

    /// Stop the agent and disconnect
    func stop() {
        bridge?.destroy()
        bridge = nil
        updateStatus(.disconnected)
    }

    /// Get agent information
    func getAgentInfo() -> AgentInfo? {
        return bridge?.getInfo()
    }

    // MARK: - Event Handling

    private func handleSignalingEvent(_ event: SignalingEvent) {
        switch event {
        case .connected:
            updateStatus(.connected)

        case .disconnected:
            updateStatus(.disconnected)

        case .error(let message):
            updateStatus(.error(message: message))

        case .sessionRequest(let sessionId, let engineerId):
            // Show consent dialog
            showSessionConsentDialog(sessionId: sessionId, engineerId: engineerId)

        case .offer(let sessionId, _):
            // WebRTC offer received - session is now active
            updateStatus(.activeSession(sessionId: sessionId))

        case .answer, .iceCandidate:
            // These are handled internally by the Rust agent
            break
        }
    }

    // MARK: - Session Consent

    private func showSessionConsentDialog(sessionId: String, engineerId: String) {
        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }

            self.pendingSessionRequest = (sessionId, engineerId)

            let alert = NSAlert()
            alert.messageText = "Remote Support Request"
            alert.informativeText = """
            A support technician (\(engineerId)) is requesting to connect to your computer.

            If you accept:
            • They will be able to see your screen
            • They will be able to control your mouse and keyboard

            Only accept if you requested support from this technician.
            """
            alert.alertStyle = .warning
            alert.addButton(withTitle: "Accept")
            alert.addButton(withTitle: "Deny")

            // Bring app to front
            NSApp.activate(ignoringOtherApps: true)

            let response = alert.runModal()

            if response == .alertFirstButtonReturn {
                self.acceptSession(sessionId: sessionId)
            } else {
                self.denySession(sessionId: sessionId)
            }

            self.pendingSessionRequest = nil
        }
    }

    private func acceptSession(sessionId: String) {
        guard let bridge = bridge else { return }

        if bridge.acceptSession(sessionId: sessionId) {
            // Session will become active when we receive the offer
        } else {
            updateStatus(.error(message: "Failed to accept session"))
        }
    }

    private func denySession(sessionId: String) {
        guard let bridge = bridge else { return }

        _ = bridge.denySession(sessionId: sessionId)
        // Stay connected, just denied this session
    }

    // MARK: - Status Updates

    private func updateStatus(_ newStatus: AgentStatus) {
        DispatchQueue.main.async { [weak self] in
            self?.status = newStatus
            NotificationCenter.default.post(name: .agentStatusChanged, object: nil)
        }
    }
}
