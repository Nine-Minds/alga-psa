//! Windows Service Client for communication with the Session 0 service.
//!
//! This module provides the user-mode agent with access to secure desktop
//! features via the named pipe interface exposed by the Windows service.

use std::sync::Arc;
use std::time::Duration;

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use tokio::sync::{mpsc, Mutex, RwLock};
use tracing::{debug, error, info, warn};
use uuid::Uuid;

/// Named pipe path for service communication
pub const SERVICE_PIPE_NAME: &str = r"\\.\pipe\alga-remote-desktop-service";

/// Maximum message size (16 MB)
pub const MAX_MESSAGE_SIZE: usize = 16 * 1024 * 1024;

/// Reconnect interval on connection failure
const RECONNECT_INTERVAL: Duration = Duration::from_secs(5);

/// IPC message types (must match service)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ServiceRequest {
    Ping,
    Authenticate(AuthenticateRequest),
    CaptureFrame(CaptureFrameRequest),
    InjectInput(InjectInputRequest),
    GetDesktopState,
    StartCapture(StartCaptureConfig),
    StopCapture,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ServiceResponse {
    Pong,
    Authenticate(AuthenticateResponse),
    CaptureFrame(CaptureFrameResponse),
    InjectInput(InjectInputResponse),
    DesktopState(DesktopStateResponse),
    CaptureStarted,
    CaptureStopped,
    Error(ServiceError),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ServiceNotification {
    DesktopSwitch(DesktopSwitchEvent),
    SessionEvent(SessionEvent),
    FrameAvailable(FrameData),
}

// Re-export types from service IPC module
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuthenticateRequest {
    pub agent_id: Uuid,
    pub connection_token: String,
    pub process_id: u32,
    pub session_id: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuthenticateResponse {
    pub success: bool,
    pub session_token: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CaptureFrameRequest {
    pub monitor_index: u32,
    pub quality: u8,
    pub max_width: Option<u32>,
    pub max_height: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CaptureFrameResponse {
    pub success: bool,
    pub frame: Option<FrameData>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FrameData {
    pub width: u32,
    pub height: u32,
    pub format: ImageFormat,
    pub data: Vec<u8>,
    pub timestamp_ms: u64,
    pub monitor_index: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ImageFormat {
    Jpeg,
    Png,
    Raw,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InjectInputRequest {
    pub event: InputEvent,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum InputEvent {
    MouseMove { x: i32, y: i32, relative: bool },
    MouseButton { button: MouseButton, pressed: bool },
    MouseWheel { delta_x: i32, delta_y: i32 },
    Key { key_code: u16, scan_code: u16, pressed: bool, extended: bool },
    SpecialKeyCombination(SpecialKeyCombo),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum MouseButton {
    Left,
    Right,
    Middle,
    X1,
    X2,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum SpecialKeyCombo {
    CtrlAltDel,
    WinL,
    AltTab,
    AltF4,
    WinR,
    CtrlShiftEsc,
    WinD,
    PrintScreen,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InjectInputResponse {
    pub success: bool,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DesktopStateResponse {
    pub desktop_type: DesktopType,
    pub is_locked: bool,
    pub session_id: u32,
    pub session_state: SessionState,
    pub user_name: Option<String>,
    pub monitor_count: u32,
    pub monitors: Vec<MonitorInfo>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum DesktopType {
    Default,
    Secure,
    Winlogon,
    ScreenSaver,
    Unknown,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum SessionState {
    Active,
    Connected,
    Disconnected,
    WTSListen,
    Reset,
    Shadow,
    Locked,
    Unknown,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MonitorInfo {
    pub index: u32,
    pub name: String,
    pub primary: bool,
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    pub scale_factor: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StartCaptureConfig {
    pub monitor_index: u32,
    pub fps: u32,
    pub quality: u8,
    pub max_width: Option<u32>,
    pub max_height: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DesktopSwitchEvent {
    pub from: DesktopType,
    pub to: DesktopType,
    pub timestamp_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionEvent {
    pub event_type: SessionEventType,
    pub session_id: u32,
    pub timestamp_ms: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum SessionEventType {
    Logon,
    Logoff,
    Lock,
    Unlock,
    RemoteConnect,
    RemoteDisconnect,
    ConsoleConnect,
    ConsoleDisconnect,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServiceError {
    pub code: u32,
    pub message: String,
}

/// Connection state
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ConnectionState {
    Disconnected,
    Connecting,
    Connected,
    Authenticated,
}

/// Service client for communicating with the Windows service
pub struct ServiceClient {
    /// Agent ID
    agent_id: Uuid,
    /// Connection token
    connection_token: String,
    /// Current connection state
    state: Arc<RwLock<ConnectionState>>,
    /// Session token after authentication
    session_token: Arc<RwLock<Option<String>>>,
    /// Channel for receiving notifications
    notification_rx: Option<mpsc::Receiver<ServiceNotification>>,
    /// Notification sender for internal use
    notification_tx: mpsc::Sender<ServiceNotification>,
}

impl ServiceClient {
    /// Create a new service client
    pub fn new(agent_id: Uuid, connection_token: String) -> Self {
        let (notification_tx, notification_rx) = mpsc::channel(256);

        Self {
            agent_id,
            connection_token,
            state: Arc::new(RwLock::new(ConnectionState::Disconnected)),
            session_token: Arc::new(RwLock::new(None)),
            notification_rx: Some(notification_rx),
            notification_tx,
        }
    }

    /// Take the notification receiver (can only be called once)
    pub fn take_notification_receiver(&mut self) -> Option<mpsc::Receiver<ServiceNotification>> {
        self.notification_rx.take()
    }

    /// Get the current connection state
    pub async fn state(&self) -> ConnectionState {
        *self.state.read().await
    }

    /// Check if the service is available
    pub async fn is_service_available(&self) -> bool {
        self.ping().await.is_ok()
    }

    /// Check if authenticated
    pub async fn is_authenticated(&self) -> bool {
        *self.state.read().await == ConnectionState::Authenticated
    }

    /// Connect and authenticate with the service
    pub async fn connect(&self) -> Result<()> {
        *self.state.write().await = ConnectionState::Connecting;

        // Check if service is available
        if let Err(e) = self.ping().await {
            *self.state.write().await = ConnectionState::Disconnected;
            return Err(e);
        }

        *self.state.write().await = ConnectionState::Connected;

        // Authenticate
        let auth_request = AuthenticateRequest {
            agent_id: self.agent_id,
            connection_token: self.connection_token.clone(),
            process_id: std::process::id(),
            session_id: get_current_session_id(),
        };

        let response = self.send_request(ServiceRequest::Authenticate(auth_request)).await?;

        match response {
            ServiceResponse::Authenticate(auth_response) => {
                if auth_response.success {
                    *self.session_token.write().await = auth_response.session_token;
                    *self.state.write().await = ConnectionState::Authenticated;
                    info!("Successfully authenticated with Windows service");
                    Ok(())
                } else {
                    *self.state.write().await = ConnectionState::Connected;
                    Err(anyhow::anyhow!(
                        "Authentication failed: {}",
                        auth_response.error.unwrap_or_default()
                    ))
                }
            }
            ServiceResponse::Error(e) => {
                *self.state.write().await = ConnectionState::Connected;
                Err(anyhow::anyhow!("Authentication error: {}", e.message))
            }
            _ => {
                *self.state.write().await = ConnectionState::Connected;
                Err(anyhow::anyhow!("Unexpected response type"))
            }
        }
    }

    /// Ping the service
    pub async fn ping(&self) -> Result<()> {
        let response = self.send_request(ServiceRequest::Ping).await?;
        match response {
            ServiceResponse::Pong => Ok(()),
            _ => Err(anyhow::anyhow!("Unexpected response to ping")),
        }
    }

    /// Get the current desktop state
    pub async fn get_desktop_state(&self) -> Result<DesktopStateResponse> {
        let response = self.send_request(ServiceRequest::GetDesktopState).await?;
        match response {
            ServiceResponse::DesktopState(state) => Ok(state),
            ServiceResponse::Error(e) => Err(anyhow::anyhow!("{}", e.message)),
            _ => Err(anyhow::anyhow!("Unexpected response type")),
        }
    }

    /// Capture a single frame from the secure desktop
    pub async fn capture_frame(
        &self,
        monitor_index: u32,
        quality: u8,
    ) -> Result<FrameData> {
        let request = CaptureFrameRequest {
            monitor_index,
            quality,
            max_width: None,
            max_height: None,
        };

        let response = self.send_request(ServiceRequest::CaptureFrame(request)).await?;
        match response {
            ServiceResponse::CaptureFrame(capture_response) => {
                if capture_response.success {
                    capture_response
                        .frame
                        .ok_or_else(|| anyhow::anyhow!("No frame data"))
                } else {
                    Err(anyhow::anyhow!(
                        "Capture failed: {}",
                        capture_response.error.unwrap_or_default()
                    ))
                }
            }
            ServiceResponse::Error(e) => Err(anyhow::anyhow!("{}", e.message)),
            _ => Err(anyhow::anyhow!("Unexpected response type")),
        }
    }

    /// Inject input on the secure desktop
    pub async fn inject_input(&self, event: InputEvent) -> Result<()> {
        let request = InjectInputRequest { event };
        let response = self.send_request(ServiceRequest::InjectInput(request)).await?;

        match response {
            ServiceResponse::InjectInput(inject_response) => {
                if inject_response.success {
                    Ok(())
                } else {
                    Err(anyhow::anyhow!(
                        "Input injection failed: {}",
                        inject_response.error.unwrap_or_default()
                    ))
                }
            }
            ServiceResponse::Error(e) => Err(anyhow::anyhow!("{}", e.message)),
            _ => Err(anyhow::anyhow!("Unexpected response type")),
        }
    }

    /// Send a special key combination (e.g., Ctrl+Alt+Del)
    pub async fn send_special_key(&self, combo: SpecialKeyCombo) -> Result<()> {
        self.inject_input(InputEvent::SpecialKeyCombination(combo)).await
    }

    /// Start continuous capture from the secure desktop
    pub async fn start_capture(&self, config: StartCaptureConfig) -> Result<()> {
        let response = self.send_request(ServiceRequest::StartCapture(config)).await?;
        match response {
            ServiceResponse::CaptureStarted => Ok(()),
            ServiceResponse::Error(e) => Err(anyhow::anyhow!("{}", e.message)),
            _ => Err(anyhow::anyhow!("Unexpected response type")),
        }
    }

    /// Stop continuous capture
    pub async fn stop_capture(&self) -> Result<()> {
        let response = self.send_request(ServiceRequest::StopCapture).await?;
        match response {
            ServiceResponse::CaptureStopped => Ok(()),
            ServiceResponse::Error(e) => Err(anyhow::anyhow!("{}", e.message)),
            _ => Err(anyhow::anyhow!("Unexpected response type")),
        }
    }

    /// Send a request to the service and wait for response
    async fn send_request(&self, request: ServiceRequest) -> Result<ServiceResponse> {
        // This runs in a blocking task since Windows named pipes are blocking
        let request_bytes = serde_json::to_vec(&request)?;

        tokio::task::spawn_blocking(move || {
            send_request_blocking(&request_bytes)
        })
        .await?
    }
}

/// Send a request to the service (blocking)
#[cfg(windows)]
fn send_request_blocking(request_bytes: &[u8]) -> Result<ServiceResponse> {
    use std::fs::OpenOptions;
    use std::io::{Read, Write};
    use std::os::windows::fs::OpenOptionsExt;

    // Open the named pipe
    let mut pipe = OpenOptions::new()
        .read(true)
        .write(true)
        .custom_flags(0x00000000) // FILE_FLAG_OVERLAPPED would be 0x40000000
        .open(SERVICE_PIPE_NAME)
        .context("Failed to connect to service pipe")?;

    // Write request
    pipe.write_all(request_bytes)?;
    pipe.flush()?;

    // Read response
    let mut response_buffer = vec![0u8; MAX_MESSAGE_SIZE];
    let bytes_read = pipe.read(&mut response_buffer)?;

    // Deserialize response
    let response: ServiceResponse = serde_json::from_slice(&response_buffer[..bytes_read])
        .context("Failed to deserialize response")?;

    Ok(response)
}

#[cfg(not(windows))]
fn send_request_blocking(_request_bytes: &[u8]) -> Result<ServiceResponse> {
    Err(anyhow::anyhow!("Windows service client only available on Windows"))
}

/// Get the current Windows session ID
#[cfg(windows)]
fn get_current_session_id() -> u32 {
    use windows::Win32::System::RemoteDesktop::WTSGetActiveConsoleSessionId;
    unsafe { WTSGetActiveConsoleSessionId() }
}

#[cfg(not(windows))]
fn get_current_session_id() -> u32 {
    0
}

/// Check if the Windows service is running
pub async fn is_service_running() -> bool {
    #[cfg(windows)]
    {
        use std::ffi::OsStr;
        use windows::Win32::System::Services::{
            OpenSCManagerW, OpenServiceW, QueryServiceStatus, CloseServiceHandle,
            SC_MANAGER_CONNECT, SERVICE_QUERY_STATUS, SERVICE_RUNNING,
        };
        use windows::core::PCWSTR;

        unsafe {
            let manager = OpenSCManagerW(PCWSTR::null(), PCWSTR::null(), SC_MANAGER_CONNECT);
            if let Ok(manager) = manager {
                let service_name: Vec<u16> = "AlgaRemoteDesktopService"
                    .encode_utf16()
                    .chain(std::iter::once(0))
                    .collect();

                let service = OpenServiceW(manager, PCWSTR(service_name.as_ptr()), SERVICE_QUERY_STATUS);
                if let Ok(service) = service {
                    let mut status = std::mem::zeroed();
                    if QueryServiceStatus(service, &mut status).is_ok() {
                        CloseServiceHandle(service);
                        CloseServiceHandle(manager);
                        return status.dwCurrentState == SERVICE_RUNNING.0;
                    }
                    CloseServiceHandle(service);
                }
                CloseServiceHandle(manager);
            }
        }
        false
    }

    #[cfg(not(windows))]
    {
        false
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
    fn test_special_key_combo() {
        let event = InputEvent::SpecialKeyCombination(SpecialKeyCombo::CtrlAltDel);
        let json = serde_json::to_string(&event).unwrap();
        assert!(json.contains("CtrlAltDel"));
    }
}
