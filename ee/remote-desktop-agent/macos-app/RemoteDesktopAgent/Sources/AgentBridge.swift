import Foundation

/// Swift bridge to the Rust Remote Desktop Agent library
///
/// This class provides a Swift-friendly wrapper around the C FFI functions
/// exported by the Rust library. It handles memory management and type conversion.
final class AgentBridge {
    /// Opaque handle to the Rust agent
    private var handle: OpaquePointer?

    /// Callback context for signaling events
    private var callbackContext: UnsafeMutableRawPointer?

    /// Event handler closure
    private var eventHandler: ((SignalingEvent) -> Void)?

    /// Initialize the Rust logging system
    static func initLogging() {
        rd_agent_init_logging()
    }

    /// Check macOS permissions
    static func checkPermissions() -> PermissionStatus {
        guard let jsonPtr = rd_agent_check_permissions() else {
            return PermissionStatus(screenRecording: false, accessibility: false)
        }
        defer { rd_agent_free_string(jsonPtr) }

        let json = String(cString: jsonPtr)
        guard let data = json.data(using: .utf8),
              let dict = try? JSONSerialization.jsonObject(with: data) as? [String: Bool] else {
            return PermissionStatus(screenRecording: false, accessibility: false)
        }

        return PermissionStatus(
            screenRecording: dict["screen_recording"] ?? false,
            accessibility: dict["accessibility"] ?? false
        )
    }

    /// Create a new agent with the given configuration
    init?(config: AgentConfig) {
        guard let configJson = config.toJSON() else {
            return nil
        }

        handle = configJson.withCString { ptr in
            rd_agent_create(ptr)
        }

        guard handle != nil else {
            return nil
        }
    }

    deinit {
        destroy()
    }

    /// Connect to the signaling server
    func connect(eventHandler: @escaping (SignalingEvent) -> Void) -> Bool {
        guard let handle = handle else { return false }

        self.eventHandler = eventHandler

        // Create a context that points to self
        let context = Unmanaged.passUnretained(self).toOpaque()
        self.callbackContext = context

        let result = rd_agent_connect(handle, signalingCallback, context)
        return result == RD_AGENT_SUCCESS
    }

    /// Accept a session request
    func acceptSession(sessionId: String) -> Bool {
        guard let handle = handle else { return false }

        let result = sessionId.withCString { ptr in
            rd_agent_accept_session(handle, ptr)
        }
        return result == RD_AGENT_SUCCESS
    }

    /// Deny a session request
    func denySession(sessionId: String) -> Bool {
        guard let handle = handle else { return false }

        let result = sessionId.withCString { ptr in
            rd_agent_deny_session(handle, ptr)
        }
        return result == RD_AGENT_SUCCESS
    }

    /// Inject an input event
    func injectInput(event: InputEvent) -> Bool {
        guard let handle = handle,
              let eventJson = event.toJSON() else { return false }

        let result = eventJson.withCString { ptr in
            rd_agent_inject_input(handle, ptr)
        }
        return result == RD_AGENT_SUCCESS
    }

    /// Get agent information
    func getInfo() -> AgentInfo? {
        guard let handle = handle,
              let infoPtr = rd_agent_get_info(handle) else {
            return nil
        }
        defer { rd_agent_free_string(infoPtr) }

        let json = String(cString: infoPtr)
        return AgentInfo.from(json: json)
    }

    /// Destroy the agent and release resources
    func destroy() {
        if let handle = handle {
            rd_agent_destroy(handle)
            self.handle = nil
        }
        callbackContext = nil
        eventHandler = nil
    }

    /// Handle signaling event from Rust
    fileprivate func handleSignalingEvent(eventType: String, sessionId: String, payload: String) {
        let event: SignalingEvent

        switch eventType {
        case "connected":
            event = .connected
        case "disconnected":
            event = .disconnected
        case "error":
            event = .error(message: payload)
        case "session_request":
            event = .sessionRequest(sessionId: sessionId, engineerId: payload)
        case "offer":
            event = .offer(sessionId: sessionId, sdp: payload)
        case "answer":
            event = .answer(sessionId: sessionId, sdp: payload)
        case "ice_candidate":
            event = .iceCandidate(sessionId: sessionId, candidate: payload)
        default:
            return
        }

        // Call event handler on main queue
        DispatchQueue.main.async { [weak self] in
            self?.eventHandler?(event)
        }
    }
}

/// C callback function for signaling events
private func signalingCallback(
    eventType: UnsafePointer<CChar>?,
    sessionId: UnsafePointer<CChar>?,
    payload: UnsafePointer<CChar>?,
    context: UnsafeMutableRawPointer?
) {
    guard let context = context,
          let eventTypePtr = eventType,
          let sessionIdPtr = sessionId,
          let payloadPtr = payload else {
        return
    }

    let bridge = Unmanaged<AgentBridge>.fromOpaque(context).takeUnretainedValue()
    let eventTypeStr = String(cString: eventTypePtr)
    let sessionIdStr = String(cString: sessionIdPtr)
    let payloadStr = String(cString: payloadPtr)

    bridge.handleSignalingEvent(eventType: eventTypeStr, sessionId: sessionIdStr, payload: payloadStr)
}

// MARK: - Supporting Types

/// Signaling events from the Rust agent
enum SignalingEvent {
    case connected
    case disconnected
    case error(message: String)
    case sessionRequest(sessionId: String, engineerId: String)
    case offer(sessionId: String, sdp: String)
    case answer(sessionId: String, sdp: String)
    case iceCandidate(sessionId: String, candidate: String)
}

/// Agent configuration
struct AgentConfig: Codable {
    struct Agent: Codable {
        let agentId: String
        let agentName: String
        let connectionToken: String

        enum CodingKeys: String, CodingKey {
            case agentId = "agent_id"
            case agentName = "agent_name"
            case connectionToken = "connection_token"
        }
    }

    struct Server: Codable {
        let signalingUrl: String
        let apiUrl: String

        enum CodingKeys: String, CodingKey {
            case signalingUrl = "signaling_url"
            case apiUrl = "api_url"
        }
    }

    struct Capture: Codable {
        let fps: UInt32
        let quality: UInt8
        let maxWidth: UInt32
        let maxHeight: UInt32

        enum CodingKeys: String, CodingKey {
            case fps
            case quality
            case maxWidth = "max_width"
            case maxHeight = "max_height"
        }
    }

    struct Network: Codable {
        let stunServers: [String]
        let reconnectIntervalMs: UInt64
        let maxReconnectAttempts: UInt32

        enum CodingKeys: String, CodingKey {
            case stunServers = "stun_servers"
            case reconnectIntervalMs = "reconnect_interval_ms"
            case maxReconnectAttempts = "max_reconnect_attempts"
        }
    }

    struct Logging: Codable {
        let level: String
        let file: String
    }

    let agent: Agent
    let server: Server
    let capture: Capture
    let network: Network
    let logging: Logging

    func toJSON() -> String? {
        let encoder = JSONEncoder()
        encoder.outputFormatting = .prettyPrinted
        guard let data = try? encoder.encode(self) else { return nil }
        return String(data: data, encoding: .utf8)
    }

    static func load(from path: String) -> AgentConfig? {
        guard let data = FileManager.default.contents(atPath: path) else { return nil }
        let decoder = JSONDecoder()
        return try? decoder.decode(AgentConfig.self, from: data)
    }

    func save(to path: String) -> Bool {
        let encoder = JSONEncoder()
        encoder.outputFormatting = .prettyPrinted
        guard let data = try? encoder.encode(self) else { return false }

        let url = URL(fileURLWithPath: path)
        try? FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)

        return FileManager.default.createFile(atPath: path, contents: data)
    }
}

/// Input event types
enum InputEvent {
    case mouseMove(x: Int32, y: Int32)
    case mouseDown(button: String)
    case mouseUp(button: String)
    case mouseScroll(deltaX: Int32, deltaY: Int32)
    case keyDown(key: String)
    case keyUp(key: String)

    func toJSON() -> String? {
        let dict: [String: Any]

        switch self {
        case .mouseMove(let x, let y):
            dict = ["type": "MouseMove", "x": x, "y": y]
        case .mouseDown(let button):
            dict = ["type": "MouseDown", "button": button]
        case .mouseUp(let button):
            dict = ["type": "MouseUp", "button": button]
        case .mouseScroll(let deltaX, let deltaY):
            dict = ["type": "MouseScroll", "delta_x": deltaX, "delta_y": deltaY]
        case .keyDown(let key):
            dict = ["type": "KeyDown", "key": key]
        case .keyUp(let key):
            dict = ["type": "KeyUp", "key": key]
        }

        guard let data = try? JSONSerialization.data(withJSONObject: dict) else { return nil }
        return String(data: data, encoding: .utf8)
    }
}

/// Agent information
struct AgentInfo {
    let agentId: String
    let agentName: String
    let version: String

    static func from(json: String) -> AgentInfo? {
        guard let data = json.data(using: .utf8),
              let dict = try? JSONSerialization.jsonObject(with: data) as? [String: String] else {
            return nil
        }

        guard let agentId = dict["agent_id"],
              let agentName = dict["agent_name"],
              let version = dict["version"] else {
            return nil
        }

        return AgentInfo(agentId: agentId, agentName: agentName, version: version)
    }
}

/// Permission status
struct PermissionStatus {
    let screenRecording: Bool
    let accessibility: Bool
}
