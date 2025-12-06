//! Named Pipe Server for IPC between the Windows Service and User-Mode Agent.
//!
//! The service exposes a named pipe at `\\.\pipe\alga-remote-desktop-service`
//! for user-mode agents to connect and request:
//! - Screen capture from secure desktops (UAC, lock screen)
//! - Input injection with elevated privileges
//! - Desktop state and session event notifications

use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::Arc;

use anyhow::{Context, Result};
use tokio::sync::{mpsc, RwLock};
use tokio::task::JoinHandle;
use tracing::{debug, error, info, warn};
use uuid::Uuid;

use crate::capture::SecureDesktopCapture;
use crate::desktop::{get_desktop_state, inject_input};
use crate::ipc::*;
use crate::service::SessionChangeEvent;

/// Named pipe server state
pub struct PipeServer {
    /// Connected clients by session token
    clients: Arc<RwLock<HashMap<String, ClientConnection>>>,
    /// Channel for broadcasting notifications to all clients
    notification_tx: mpsc::Sender<ServiceNotification>,
    /// Secure desktop capture instance
    capture: Arc<SecureDesktopCapture>,
}

/// A connected client
struct ClientConnection {
    /// Client's session token
    session_token: String,
    /// Agent ID
    agent_id: Uuid,
    /// Process ID of the connected agent
    process_id: u32,
    /// Session ID of the connected agent
    session_id: u32,
    /// Channel for sending notifications to this client
    notification_tx: mpsc::Sender<ServiceNotification>,
}

impl PipeServer {
    /// Create a new pipe server
    pub async fn new() -> Result<Self> {
        let (notification_tx, _notification_rx) = mpsc::channel(256);

        Ok(Self {
            clients: Arc::new(RwLock::new(HashMap::new())),
            notification_tx,
            capture: Arc::new(SecureDesktopCapture::new()?),
        })
    }

    /// Start the pipe server
    pub async fn start(&self) -> Result<JoinHandle<()>> {
        let clients = self.clients.clone();
        let capture = self.capture.clone();

        let handle = tokio::task::spawn_blocking(move || {
            if let Err(e) = run_pipe_server(clients, capture) {
                error!("Pipe server error: {:?}", e);
            }
        });

        info!("Named pipe server started at {}", SERVICE_PIPE_NAME);
        Ok(handle)
    }

    /// Notify all connected clients of a session change
    pub async fn notify_session_change(&self, event: SessionChangeEvent) {
        let notification = ServiceNotification::SessionEvent(crate::ipc::SessionEvent {
            event_type: match event.event_type {
                crate::service::SessionChangeType::SessionLogon => SessionEventType::Logon,
                crate::service::SessionChangeType::SessionLogoff => SessionEventType::Logoff,
                crate::service::SessionChangeType::SessionLock => SessionEventType::Lock,
                crate::service::SessionChangeType::SessionUnlock => SessionEventType::Unlock,
                crate::service::SessionChangeType::RemoteConnect => SessionEventType::RemoteConnect,
                crate::service::SessionChangeType::RemoteDisconnect => {
                    SessionEventType::RemoteDisconnect
                }
                crate::service::SessionChangeType::ConsoleConnect => SessionEventType::ConsoleConnect,
                crate::service::SessionChangeType::ConsoleDisconnect => {
                    SessionEventType::ConsoleDisconnect
                }
                _ => return,
            },
            session_id: event.session_id,
            timestamp_ms: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis() as u64,
        });

        let clients = self.clients.read().await;
        for client in clients.values() {
            let _ = client.notification_tx.try_send(notification.clone());
        }
    }

    /// Notify all clients of a desktop switch
    pub async fn notify_desktop_switch(&self, from: DesktopType, to: DesktopType) {
        let notification = ServiceNotification::DesktopSwitch(DesktopSwitchEvent {
            from,
            to,
            timestamp_ms: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis() as u64,
        });

        let clients = self.clients.read().await;
        for client in clients.values() {
            let _ = client.notification_tx.try_send(notification.clone());
        }
    }
}

/// Run the named pipe server (blocking)
fn run_pipe_server(
    clients: Arc<RwLock<HashMap<String, ClientConnection>>>,
    capture: Arc<SecureDesktopCapture>,
) -> Result<()> {
    use windows::Win32::Foundation::{CloseHandle, HANDLE, INVALID_HANDLE_VALUE};
    use windows::Win32::Security::{
        InitializeSecurityDescriptor, SetSecurityDescriptorDacl, PSECURITY_DESCRIPTOR,
        SECURITY_ATTRIBUTES, SECURITY_DESCRIPTOR,
    };
    use windows::Win32::Storage::FileSystem::{ReadFile, WriteFile};
    use windows::Win32::System::Pipes::{
        ConnectNamedPipe, CreateNamedPipeW, DisconnectNamedPipe, PIPE_ACCESS_DUPLEX,
        PIPE_READMODE_MESSAGE, PIPE_TYPE_MESSAGE, PIPE_UNLIMITED_INSTANCES, PIPE_WAIT,
    };
    use windows::core::PCWSTR;

    // Create security attributes that allow all users to connect
    let mut sd: SECURITY_DESCRIPTOR = unsafe { std::mem::zeroed() };
    unsafe {
        InitializeSecurityDescriptor(
            PSECURITY_DESCRIPTOR(&mut sd as *mut _ as *mut _),
            1, // SECURITY_DESCRIPTOR_REVISION
        )
        .context("Failed to initialize security descriptor")?;

        SetSecurityDescriptorDacl(
            PSECURITY_DESCRIPTOR(&mut sd as *mut _ as *mut _),
            true.into(),
            None,
            false.into(),
        )
        .context("Failed to set security descriptor DACL")?;
    }

    let sa = SECURITY_ATTRIBUTES {
        nLength: std::mem::size_of::<SECURITY_ATTRIBUTES>() as u32,
        lpSecurityDescriptor: &mut sd as *mut _ as *mut _,
        bInheritHandle: false.into(),
    };

    // Convert pipe name to wide string
    let pipe_name: Vec<u16> = SERVICE_PIPE_NAME
        .encode_utf16()
        .chain(std::iter::once(0))
        .collect();

    loop {
        // Create named pipe instance
        let pipe_handle = unsafe {
            CreateNamedPipeW(
                PCWSTR(pipe_name.as_ptr()),
                PIPE_ACCESS_DUPLEX,
                PIPE_TYPE_MESSAGE | PIPE_READMODE_MESSAGE | PIPE_WAIT,
                PIPE_UNLIMITED_INSTANCES,
                MAX_MESSAGE_SIZE as u32,
                MAX_MESSAGE_SIZE as u32,
                0, // Default timeout
                Some(&sa),
            )
        };

        if pipe_handle == INVALID_HANDLE_VALUE {
            error!("Failed to create named pipe");
            std::thread::sleep(std::time::Duration::from_secs(1));
            continue;
        }

        info!("Waiting for client connection...");

        // Wait for client to connect
        let connected = unsafe { ConnectNamedPipe(pipe_handle, None) };
        if connected.is_err() {
            let error = std::io::Error::last_os_error();
            if error.raw_os_error() != Some(535) {
                // ERROR_PIPE_CONNECTED is OK
                warn!("ConnectNamedPipe failed: {:?}", error);
                unsafe { CloseHandle(pipe_handle) };
                continue;
            }
        }

        info!("Client connected");

        // Handle client in a new thread
        let clients_clone = clients.clone();
        let capture_clone = capture.clone();

        std::thread::spawn(move || {
            if let Err(e) = handle_client(pipe_handle, clients_clone, capture_clone) {
                error!("Client handler error: {:?}", e);
            }

            // Disconnect and close the pipe
            unsafe {
                DisconnectNamedPipe(pipe_handle);
                CloseHandle(pipe_handle);
            }
            info!("Client disconnected");
        });
    }
}

/// Handle a connected client
fn handle_client(
    pipe_handle: windows::Win32::Foundation::HANDLE,
    clients: Arc<RwLock<HashMap<String, ClientConnection>>>,
    capture: Arc<SecureDesktopCapture>,
) -> Result<()> {
    use windows::Win32::Storage::FileSystem::{ReadFile, WriteFile};

    let mut read_buffer = vec![0u8; MAX_MESSAGE_SIZE];
    let mut authenticated = false;
    let mut session_token: Option<String> = None;

    loop {
        // Read message from client
        let mut bytes_read: u32 = 0;
        let read_result = unsafe {
            ReadFile(
                pipe_handle,
                Some(&mut read_buffer),
                Some(&mut bytes_read),
                None,
            )
        };

        if read_result.is_err() || bytes_read == 0 {
            break;
        }

        // Deserialize request
        let request: ServiceRequest = match serde_json::from_slice(&read_buffer[..bytes_read as usize])
        {
            Ok(req) => req,
            Err(e) => {
                warn!("Failed to deserialize request: {:?}", e);
                let response = ServiceResponse::Error(ServiceError::new(400, "Invalid request format"));
                send_response(pipe_handle, &response)?;
                continue;
            }
        };

        debug!("Received request: {:?}", request);

        // Handle request
        let response = match request {
            ServiceRequest::Ping => ServiceResponse::Pong,

            ServiceRequest::Authenticate(auth_req) => {
                // TODO: Validate connection token against the server
                // For now, accept all connections from the local machine
                let token = Uuid::new_v4().to_string();

                // Create notification channel for this client
                let (notification_tx, _notification_rx) = mpsc::channel(64);

                // Store client connection
                let client = ClientConnection {
                    session_token: token.clone(),
                    agent_id: auth_req.agent_id,
                    process_id: auth_req.process_id,
                    session_id: auth_req.session_id,
                    notification_tx,
                };

                // Use blocking runtime to access async RwLock
                let rt = tokio::runtime::Handle::try_current();
                if let Ok(handle) = rt {
                    handle.block_on(async {
                        let mut clients_guard = clients.write().await;
                        clients_guard.insert(token.clone(), client);
                    });
                }

                authenticated = true;
                session_token = Some(token.clone());

                info!(
                    "Client authenticated: agent_id={}, process_id={}, session_id={}",
                    auth_req.agent_id, auth_req.process_id, auth_req.session_id
                );

                ServiceResponse::Authenticate(AuthenticateResponse {
                    success: true,
                    session_token: Some(token),
                    error: None,
                })
            }

            ServiceRequest::CaptureFrame(req) => {
                if !authenticated {
                    ServiceResponse::Error(ServiceError::authentication_failed(
                        "Not authenticated",
                    ))
                } else {
                    match capture.capture_frame(req.monitor_index, req.quality) {
                        Ok(frame) => ServiceResponse::CaptureFrame(CaptureFrameResponse {
                            success: true,
                            frame: Some(frame),
                            error: None,
                        }),
                        Err(e) => ServiceResponse::CaptureFrame(CaptureFrameResponse {
                            success: false,
                            frame: None,
                            error: Some(e.to_string()),
                        }),
                    }
                }
            }

            ServiceRequest::InjectInput(req) => {
                if !authenticated {
                    ServiceResponse::Error(ServiceError::authentication_failed(
                        "Not authenticated",
                    ))
                } else {
                    match inject_input(&req.event) {
                        Ok(()) => ServiceResponse::InjectInput(InjectInputResponse {
                            success: true,
                            error: None,
                        }),
                        Err(e) => ServiceResponse::InjectInput(InjectInputResponse {
                            success: false,
                            error: Some(e.to_string()),
                        }),
                    }
                }
            }

            ServiceRequest::GetDesktopState => {
                if !authenticated {
                    ServiceResponse::Error(ServiceError::authentication_failed(
                        "Not authenticated",
                    ))
                } else {
                    match get_desktop_state() {
                        Ok(state) => ServiceResponse::DesktopState(state),
                        Err(e) => ServiceResponse::Error(ServiceError::internal_error(e.to_string())),
                    }
                }
            }

            ServiceRequest::StartCapture(config) => {
                if !authenticated {
                    ServiceResponse::Error(ServiceError::authentication_failed(
                        "Not authenticated",
                    ))
                } else {
                    match capture.start_capture(config) {
                        Ok(()) => ServiceResponse::CaptureStarted,
                        Err(e) => ServiceResponse::Error(ServiceError::capture_failed(e.to_string())),
                    }
                }
            }

            ServiceRequest::StopCapture => {
                if !authenticated {
                    ServiceResponse::Error(ServiceError::authentication_failed(
                        "Not authenticated",
                    ))
                } else {
                    capture.stop_capture();
                    ServiceResponse::CaptureStopped
                }
            }
        };

        // Send response
        send_response(pipe_handle, &response)?;
    }

    // Clean up client connection
    if let Some(token) = session_token {
        let rt = tokio::runtime::Handle::try_current();
        if let Ok(handle) = rt {
            handle.block_on(async {
                let mut clients_guard = clients.write().await;
                clients_guard.remove(&token);
            });
        }
    }

    Ok(())
}

/// Send a response to the client
fn send_response(
    pipe_handle: windows::Win32::Foundation::HANDLE,
    response: &ServiceResponse,
) -> Result<()> {
    use windows::Win32::Storage::FileSystem::WriteFile;

    let response_bytes = serde_json::to_vec(response).context("Failed to serialize response")?;
    let mut bytes_written: u32 = 0;

    unsafe {
        WriteFile(
            pipe_handle,
            Some(&response_bytes),
            Some(&mut bytes_written),
            None,
        )
        .context("Failed to write response")?;
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_pipe_name() {
        assert!(SERVICE_PIPE_NAME.starts_with(r"\\.\pipe\"));
    }
}
