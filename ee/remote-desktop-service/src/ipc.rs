//! IPC Protocol for communication between the Windows Service (Session 0) and the User-Mode Agent.
//!
//! The service runs as LocalSystem in Session 0, providing access to:
//! - Secure Desktop (UAC prompts, lock screen)
//! - Pre-login screen capture
//! - Elevated input injection
//!
//! Communication occurs over a named pipe: `\\.\pipe\alga-remote-desktop-service`

use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Named pipe path for service communication
pub const SERVICE_PIPE_NAME: &str = r"\\.\pipe\alga-remote-desktop-service";

/// Maximum message size (16 MB - enough for compressed screen frames)
pub const MAX_MESSAGE_SIZE: usize = 16 * 1024 * 1024;

/// IPC message header
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MessageHeader {
    /// Message type identifier
    pub message_type: MessageType,
    /// Unique message ID for request/response correlation
    pub message_id: Uuid,
    /// Payload size in bytes
    pub payload_size: u32,
}

/// Types of messages in the IPC protocol
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[repr(u8)]
pub enum MessageType {
    // Client -> Service requests
    Ping = 0,
    AuthenticateRequest = 1,
    CaptureFrameRequest = 2,
    InjectInputRequest = 3,
    GetDesktopStateRequest = 4,
    StartCaptureRequest = 5,
    StopCaptureRequest = 6,

    // Service -> Client responses
    Pong = 100,
    AuthenticateResponse = 101,
    CaptureFrameResponse = 102,
    InjectInputResponse = 103,
    GetDesktopStateResponse = 104,
    StartCaptureResponse = 105,
    StopCaptureResponse = 106,

    // Service -> Client notifications (push)
    DesktopSwitchNotification = 200,
    SessionEventNotification = 201,
    FrameAvailableNotification = 202,

    // Error response
    Error = 255,
}

/// Request from user-mode agent to the service
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ServiceRequest {
    /// Ping to check service health
    Ping,

    /// Authenticate the client connection
    Authenticate(AuthenticateRequest),

    /// Request a single frame capture from the secure desktop
    CaptureFrame(CaptureFrameRequest),

    /// Request input injection on the secure desktop
    InjectInput(InjectInputRequest),

    /// Get current desktop state
    GetDesktopState,

    /// Start continuous frame capture
    StartCapture(StartCaptureConfig),

    /// Stop continuous frame capture
    StopCapture,
}

/// Response from service to user-mode agent
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ServiceResponse {
    /// Pong response to ping
    Pong,

    /// Authentication result
    Authenticate(AuthenticateResponse),

    /// Frame capture result
    CaptureFrame(CaptureFrameResponse),

    /// Input injection result
    InjectInput(InjectInputResponse),

    /// Current desktop state
    DesktopState(DesktopStateResponse),

    /// Capture started
    CaptureStarted,

    /// Capture stopped
    CaptureStopped,

    /// Error response
    Error(ServiceError),
}

/// Notification pushed from service to agent
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ServiceNotification {
    /// Desktop has switched (e.g., to secure desktop)
    DesktopSwitch(DesktopSwitchEvent),

    /// Windows session event (lock, unlock, logon, logoff)
    SessionEvent(SessionEvent),

    /// A new frame is available
    FrameAvailable(FrameData),
}

/// Authentication request from the agent
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuthenticateRequest {
    /// The agent's ID
    pub agent_id: Uuid,
    /// Connection token for validation
    pub connection_token: String,
    /// Process ID of the requesting agent
    pub process_id: u32,
    /// Session ID of the requesting agent
    pub session_id: u32,
}

/// Authentication response
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuthenticateResponse {
    /// Whether authentication succeeded
    pub success: bool,
    /// Session token for subsequent requests (if success)
    pub session_token: Option<String>,
    /// Error message (if failed)
    pub error: Option<String>,
}

/// Request to capture a frame
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CaptureFrameRequest {
    /// Monitor index to capture (0 = primary)
    pub monitor_index: u32,
    /// JPEG quality (1-100)
    pub quality: u8,
    /// Maximum width (for downscaling)
    pub max_width: Option<u32>,
    /// Maximum height (for downscaling)
    pub max_height: Option<u32>,
}

/// Frame capture response
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CaptureFrameResponse {
    /// Whether capture succeeded
    pub success: bool,
    /// Frame data (if success)
    pub frame: Option<FrameData>,
    /// Error message (if failed)
    pub error: Option<String>,
}

/// Frame data
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FrameData {
    /// Frame width
    pub width: u32,
    /// Frame height
    pub height: u32,
    /// Image format
    pub format: ImageFormat,
    /// Compressed image data
    pub data: Vec<u8>,
    /// Timestamp when frame was captured
    pub timestamp_ms: u64,
    /// Monitor index
    pub monitor_index: u32,
}

/// Supported image formats
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ImageFormat {
    Jpeg,
    Png,
    Raw,
}

/// Request to inject input
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InjectInputRequest {
    /// Input event to inject
    pub event: InputEvent,
}

/// Input event types
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum InputEvent {
    /// Mouse movement
    MouseMove {
        x: i32,
        y: i32,
        /// Relative vs absolute coordinates
        relative: bool,
    },

    /// Mouse button press/release
    MouseButton {
        button: MouseButton,
        pressed: bool,
    },

    /// Mouse wheel scroll
    MouseWheel {
        delta_x: i32,
        delta_y: i32,
    },

    /// Key press/release
    Key {
        /// Virtual key code
        key_code: u16,
        /// Scan code
        scan_code: u16,
        /// Whether the key is pressed
        pressed: bool,
        /// Extended key flag
        extended: bool,
    },

    /// Special key combination (e.g., Ctrl+Alt+Del)
    SpecialKeyCombination(SpecialKeyCombo),
}

/// Mouse buttons
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum MouseButton {
    Left,
    Right,
    Middle,
    X1,
    X2,
}

/// Special key combinations
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum SpecialKeyCombo {
    /// Ctrl+Alt+Del - Secure Attention Sequence
    CtrlAltDel,
    /// Win+L - Lock workstation
    WinL,
    /// Alt+Tab - Task switcher
    AltTab,
    /// Alt+F4 - Close window
    AltF4,
    /// Win+R - Run dialog
    WinR,
    /// Ctrl+Shift+Esc - Task Manager
    CtrlShiftEsc,
    /// Win+D - Show desktop
    WinD,
    /// Print Screen
    PrintScreen,
}

/// Input injection response
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InjectInputResponse {
    /// Whether injection succeeded
    pub success: bool,
    /// Error message (if failed)
    pub error: Option<String>,
}

/// Desktop state information
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DesktopStateResponse {
    /// Current desktop type
    pub desktop_type: DesktopType,
    /// Whether the user session is locked
    pub is_locked: bool,
    /// Current session ID
    pub session_id: u32,
    /// Session state
    pub session_state: SessionState,
    /// Connected user (if logged in)
    pub user_name: Option<String>,
    /// Number of monitors
    pub monitor_count: u32,
    /// Monitor information
    pub monitors: Vec<MonitorInfo>,
}

/// Desktop type
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum DesktopType {
    /// Normal user desktop
    Default,
    /// Secure desktop (UAC prompt, lock screen)
    Secure,
    /// Winlogon desktop (login screen)
    Winlogon,
    /// Screensaver desktop
    ScreenSaver,
    /// Unknown desktop
    Unknown,
}

/// Session state
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum SessionState {
    /// User is logged in and active
    Active,
    /// Session is connected but inactive
    Connected,
    /// Session is disconnected (RDP, etc.)
    Disconnected,
    /// No user logged in
    WTSListen,
    /// Session is being reset
    Reset,
    /// Session shadow mode
    Shadow,
    /// Session is locked
    Locked,
    /// Unknown state
    Unknown,
}

/// Monitor information
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MonitorInfo {
    /// Monitor index
    pub index: u32,
    /// Monitor name
    pub name: String,
    /// Whether this is the primary monitor
    pub primary: bool,
    /// X position
    pub x: i32,
    /// Y position
    pub y: i32,
    /// Width in pixels
    pub width: u32,
    /// Height in pixels
    pub height: u32,
    /// DPI scaling factor
    pub scale_factor: f32,
}

/// Configuration for continuous capture
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StartCaptureConfig {
    /// Monitor index to capture (0 = primary)
    pub monitor_index: u32,
    /// Target frames per second
    pub fps: u32,
    /// JPEG quality (1-100)
    pub quality: u8,
    /// Maximum width (for downscaling)
    pub max_width: Option<u32>,
    /// Maximum height (for downscaling)
    pub max_height: Option<u32>,
}

/// Desktop switch event
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DesktopSwitchEvent {
    /// Previous desktop type
    pub from: DesktopType,
    /// New desktop type
    pub to: DesktopType,
    /// Timestamp
    pub timestamp_ms: u64,
}

/// Windows session event
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionEvent {
    /// Event type
    pub event_type: SessionEventType,
    /// Session ID
    pub session_id: u32,
    /// Timestamp
    pub timestamp_ms: u64,
}

/// Session event types
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum SessionEventType {
    /// User logged on
    Logon,
    /// User logged off
    Logoff,
    /// Session locked
    Lock,
    /// Session unlocked
    Unlock,
    /// Remote session connected
    RemoteConnect,
    /// Remote session disconnected
    RemoteDisconnect,
    /// Console connected
    ConsoleConnect,
    /// Console disconnected
    ConsoleDisconnect,
}

/// Service error
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServiceError {
    /// Error code
    pub code: u32,
    /// Error message
    pub message: String,
}

impl ServiceError {
    pub fn new(code: u32, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }

    pub fn authentication_failed(message: impl Into<String>) -> Self {
        Self::new(1001, message)
    }

    pub fn capture_failed(message: impl Into<String>) -> Self {
        Self::new(2001, message)
    }

    pub fn input_injection_failed(message: impl Into<String>) -> Self {
        Self::new(3001, message)
    }

    pub fn internal_error(message: impl Into<String>) -> Self {
        Self::new(5000, message)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_serialize_request() {
        let request = ServiceRequest::Ping;
        let json = serde_json::to_string(&request).unwrap();
        assert_eq!(json, r#""Ping""#);
    }

    #[test]
    fn test_serialize_capture_request() {
        let request = ServiceRequest::CaptureFrame(CaptureFrameRequest {
            monitor_index: 0,
            quality: 80,
            max_width: Some(1920),
            max_height: Some(1080),
        });
        let json = serde_json::to_string(&request).unwrap();
        assert!(json.contains("CaptureFrame"));
        assert!(json.contains("1920"));
    }

    #[test]
    fn test_serialize_input_event() {
        let event = InputEvent::SpecialKeyCombination(SpecialKeyCombo::CtrlAltDel);
        let json = serde_json::to_string(&event).unwrap();
        assert!(json.contains("CtrlAltDel"));
    }
}
