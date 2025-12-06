//! Windows Service implementation for Alga Remote Desktop.
//!
//! This service runs as LocalSystem in Session 0, providing:
//! - Access to the Secure Desktop (UAC prompts, lock screen)
//! - Pre-login screen capture
//! - Elevated input injection capabilities
//! - Session event monitoring (lock, unlock, logon, logoff)

use std::ffi::OsString;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use anyhow::{Context, Result};
use tokio::sync::mpsc;
use tracing::{error, info, warn};
use windows_service::service::{
    ServiceAccess, ServiceControl, ServiceControlAccept, ServiceExitCode, ServiceState,
    ServiceStatus, ServiceType,
};
use windows_service::service_control_handler::{self, ServiceControlHandlerResult};
use windows_service::service_dispatcher;

use crate::desktop::DesktopMonitor;
use crate::pipe_server::PipeServer;

/// Service name for registration
pub const SERVICE_NAME: &str = "AlgaRemoteDesktopService";

/// Service display name
pub const SERVICE_DISPLAY_NAME: &str = "Alga Remote Desktop Service";

/// Service description
pub const SERVICE_DESCRIPTION: &str =
    "Provides remote desktop access including UAC prompts and secure desktop capture for Alga PSA";

/// Defines the Windows service entry point
#[macro_export]
macro_rules! define_service_entry {
    () => {
        windows_service::define_windows_service!(ffi_service_main, service_main);

        fn service_main(arguments: Vec<OsString>) {
            if let Err(e) = run_service(arguments) {
                error!("Service error: {:?}", e);
            }
        }
    };
}

/// Service state shared between components
pub struct ServiceState {
    /// Flag indicating the service should stop
    pub stop_requested: AtomicBool,
    /// Current service status
    pub current_status: std::sync::Mutex<ServiceStatusInfo>,
}

/// Current service status information
#[derive(Clone, Debug)]
pub struct ServiceStatusInfo {
    pub state: ServiceState,
    pub checkpoint: u32,
    pub wait_hint: Duration,
}

impl Default for ServiceStatusInfo {
    fn default() -> Self {
        Self {
            state: ServiceState::StartPending,
            checkpoint: 0,
            wait_hint: Duration::from_secs(30),
        }
    }
}

/// Service state enumeration (mirrors windows_service::ServiceState)
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ServiceState {
    Stopped,
    StartPending,
    StopPending,
    Running,
    ContinuePending,
    PausePending,
    Paused,
}

impl From<ServiceState> for windows_service::service::ServiceState {
    fn from(state: ServiceState) -> Self {
        match state {
            ServiceState::Stopped => windows_service::service::ServiceState::Stopped,
            ServiceState::StartPending => windows_service::service::ServiceState::StartPending,
            ServiceState::StopPending => windows_service::service::ServiceState::StopPending,
            ServiceState::Running => windows_service::service::ServiceState::Running,
            ServiceState::ContinuePending => {
                windows_service::service::ServiceState::ContinuePending
            }
            ServiceState::PausePending => windows_service::service::ServiceState::PausePending,
            ServiceState::Paused => windows_service::service::ServiceState::Paused,
        }
    }
}

/// Commands sent to the service main loop
#[derive(Debug, Clone)]
pub enum ServiceCommand {
    Stop,
    Pause,
    Continue,
    SessionChange(SessionChangeEvent),
    Shutdown,
}

/// Session change event from the service control manager
#[derive(Debug, Clone)]
pub struct SessionChangeEvent {
    pub event_type: SessionChangeType,
    pub session_id: u32,
}

/// Types of session changes
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SessionChangeType {
    ConsoleConnect,
    ConsoleDisconnect,
    RemoteConnect,
    RemoteDisconnect,
    SessionLogon,
    SessionLogoff,
    SessionLock,
    SessionUnlock,
    SessionRemoteControl,
    SessionCreate,
    SessionTerminate,
}

/// Run the Windows service
pub fn run_service(_arguments: Vec<OsString>) -> Result<()> {
    // Initialize logging
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::from_default_env()
                .add_directive("rd_service=info".parse().unwrap()),
        )
        .init();

    info!("Starting {} service", SERVICE_NAME);

    // Create a channel for service control commands
    let (cmd_tx, mut cmd_rx) = mpsc::channel::<ServiceCommand>(16);

    // Create shared state
    let state = Arc::new(crate::service::ServiceState {
        stop_requested: AtomicBool::new(false),
        current_status: std::sync::Mutex::new(ServiceStatusInfo::default()),
    });

    // Register the service control handler
    let cmd_tx_clone = cmd_tx.clone();
    let event_handler = move |control_event| -> ServiceControlHandlerResult {
        handle_service_control(control_event, &cmd_tx_clone)
    };

    let status_handle = service_control_handler::register(SERVICE_NAME, event_handler)
        .context("Failed to register service control handler")?;

    // Report that we're starting
    report_service_status(
        &status_handle,
        windows_service::service::ServiceState::StartPending,
        ServiceExitCode::Win32(0),
        1,
        Duration::from_secs(30),
    )?;

    // Create the tokio runtime for async operations
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .context("Failed to create async runtime")?;

    // Run the service main loop
    let result = runtime.block_on(async {
        // Report running status
        report_service_status(
            &status_handle,
            windows_service::service::ServiceState::Running,
            ServiceExitCode::Win32(0),
            0,
            Duration::ZERO,
        )?;

        info!("Service is now running");

        // Start the named pipe server
        let pipe_server = PipeServer::new().await?;
        let pipe_handle = pipe_server.start().await?;

        // Start the desktop monitor for session events
        let desktop_monitor = DesktopMonitor::new(cmd_tx.clone());
        let monitor_handle = desktop_monitor.start().await?;

        // Main service loop
        loop {
            tokio::select! {
                // Check for stop request
                _ = tokio::time::sleep(Duration::from_millis(100)), if state.stop_requested.load(Ordering::SeqCst) => {
                    info!("Stop requested, shutting down...");
                    break;
                }

                // Handle service commands
                Some(cmd) = cmd_rx.recv() => {
                    match cmd {
                        ServiceCommand::Stop | ServiceCommand::Shutdown => {
                            info!("Received stop/shutdown command");
                            state.stop_requested.store(true, Ordering::SeqCst);
                            break;
                        }
                        ServiceCommand::Pause => {
                            info!("Received pause command");
                            report_service_status(
                                &status_handle,
                                windows_service::service::ServiceState::Paused,
                                ServiceExitCode::Win32(0),
                                0,
                                Duration::ZERO,
                            )?;
                        }
                        ServiceCommand::Continue => {
                            info!("Received continue command");
                            report_service_status(
                                &status_handle,
                                windows_service::service::ServiceState::Running,
                                ServiceExitCode::Win32(0),
                                0,
                                Duration::ZERO,
                            )?;
                        }
                        ServiceCommand::SessionChange(event) => {
                            info!("Session change: {:?}", event);
                            // Forward to pipe server for client notifications
                            pipe_server.notify_session_change(event).await;
                        }
                    }
                }
            }
        }

        // Clean up
        info!("Stopping pipe server...");
        pipe_handle.abort();
        monitor_handle.abort();

        Ok::<(), anyhow::Error>(())
    });

    // Report that we're stopping
    report_service_status(
        &status_handle,
        windows_service::service::ServiceState::StopPending,
        ServiceExitCode::Win32(0),
        1,
        Duration::from_secs(10),
    )?;

    // Report stopped
    report_service_status(
        &status_handle,
        windows_service::service::ServiceState::Stopped,
        ServiceExitCode::Win32(0),
        0,
        Duration::ZERO,
    )?;

    info!("Service stopped");
    result
}

/// Handle service control events from the Service Control Manager
fn handle_service_control(
    control_event: ServiceControl,
    cmd_tx: &mpsc::Sender<ServiceCommand>,
) -> ServiceControlHandlerResult {
    match control_event {
        ServiceControl::Stop => {
            info!("Service control: Stop");
            let _ = cmd_tx.blocking_send(ServiceCommand::Stop);
            ServiceControlHandlerResult::NoError
        }

        ServiceControl::Pause => {
            info!("Service control: Pause");
            let _ = cmd_tx.blocking_send(ServiceCommand::Pause);
            ServiceControlHandlerResult::NoError
        }

        ServiceControl::Continue => {
            info!("Service control: Continue");
            let _ = cmd_tx.blocking_send(ServiceCommand::Continue);
            ServiceControlHandlerResult::NoError
        }

        ServiceControl::Interrogate => ServiceControlHandlerResult::NoError,

        ServiceControl::Shutdown => {
            info!("Service control: Shutdown");
            let _ = cmd_tx.blocking_send(ServiceCommand::Shutdown);
            ServiceControlHandlerResult::NoError
        }

        ServiceControl::SessionChange(param) => {
            let event_type = match param.reason {
                windows_service::service::SessionChangeReason::ConsoleConnect => {
                    SessionChangeType::ConsoleConnect
                }
                windows_service::service::SessionChangeReason::ConsoleDisconnect => {
                    SessionChangeType::ConsoleDisconnect
                }
                windows_service::service::SessionChangeReason::RemoteConnect => {
                    SessionChangeType::RemoteConnect
                }
                windows_service::service::SessionChangeReason::RemoteDisconnect => {
                    SessionChangeType::RemoteDisconnect
                }
                windows_service::service::SessionChangeReason::SessionLogon => {
                    SessionChangeType::SessionLogon
                }
                windows_service::service::SessionChangeReason::SessionLogoff => {
                    SessionChangeType::SessionLogoff
                }
                windows_service::service::SessionChangeReason::SessionLock => {
                    SessionChangeType::SessionLock
                }
                windows_service::service::SessionChangeReason::SessionUnlock => {
                    SessionChangeType::SessionUnlock
                }
                windows_service::service::SessionChangeReason::SessionRemoteControl => {
                    SessionChangeType::SessionRemoteControl
                }
                _ => return ServiceControlHandlerResult::NoError,
            };

            let event = SessionChangeEvent {
                event_type,
                session_id: param.session_id,
            };

            let _ = cmd_tx.blocking_send(ServiceCommand::SessionChange(event));
            ServiceControlHandlerResult::NoError
        }

        _ => ServiceControlHandlerResult::NotImplemented,
    }
}

/// Report service status to the Service Control Manager
fn report_service_status(
    status_handle: &service_control_handler::ServiceStatusHandle,
    state: windows_service::service::ServiceState,
    exit_code: ServiceExitCode,
    checkpoint: u32,
    wait_hint: Duration,
) -> Result<()> {
    let controls_accepted = match state {
        windows_service::service::ServiceState::StartPending
        | windows_service::service::ServiceState::StopPending => ServiceControlAccept::empty(),
        _ => {
            ServiceControlAccept::STOP
                | ServiceControlAccept::PAUSE_CONTINUE
                | ServiceControlAccept::SHUTDOWN
                | ServiceControlAccept::SESSION_CHANGE
        }
    };

    let status = ServiceStatus {
        service_type: ServiceType::OWN_PROCESS,
        current_state: state,
        controls_accepted,
        exit_code,
        checkpoint,
        wait_hint,
        process_id: None,
    };

    status_handle
        .set_service_status(status)
        .context("Failed to set service status")?;

    Ok(())
}

/// Install the service
pub fn install_service() -> Result<()> {
    use std::ffi::OsStr;
    use windows_service::service::{ServiceInfo, ServiceStartType};
    use windows_service::service_manager::{ServiceManager, ServiceManagerAccess};

    info!("Installing service: {}", SERVICE_NAME);

    // Get the current executable path
    let service_binary_path = std::env::current_exe().context("Failed to get executable path")?;

    let manager =
        ServiceManager::local_computer(None::<&OsStr>, ServiceManagerAccess::CREATE_SERVICE)
            .context("Failed to open service manager")?;

    let service_info = ServiceInfo {
        name: OsString::from(SERVICE_NAME),
        display_name: OsString::from(SERVICE_DISPLAY_NAME),
        service_type: ServiceType::OWN_PROCESS,
        start_type: ServiceStartType::AutoStart,
        error_control: windows_service::service::ServiceErrorControl::Normal,
        executable_path: service_binary_path,
        launch_arguments: vec![],
        dependencies: vec![],
        account_name: None, // LocalSystem
        account_password: None,
    };

    let _service = manager
        .create_service(&service_info, ServiceAccess::CHANGE_CONFIG)
        .context("Failed to create service")?;

    info!("Service installed successfully");

    // Set the description
    // Note: This requires additional Windows API calls not covered by windows-service crate

    Ok(())
}

/// Uninstall the service
pub fn uninstall_service() -> Result<()> {
    use std::ffi::OsStr;
    use windows_service::service_manager::{ServiceManager, ServiceManagerAccess};

    info!("Uninstalling service: {}", SERVICE_NAME);

    let manager = ServiceManager::local_computer(None::<&OsStr>, ServiceManagerAccess::CONNECT)
        .context("Failed to open service manager")?;

    let service = manager
        .open_service(SERVICE_NAME, ServiceAccess::DELETE)
        .context("Failed to open service")?;

    service.delete().context("Failed to delete service")?;

    info!("Service uninstalled successfully");
    Ok(())
}

/// Start the service
pub fn start_service() -> Result<()> {
    use std::ffi::OsStr;
    use windows_service::service_manager::{ServiceManager, ServiceManagerAccess};

    info!("Starting service: {}", SERVICE_NAME);

    let manager = ServiceManager::local_computer(None::<&OsStr>, ServiceManagerAccess::CONNECT)
        .context("Failed to open service manager")?;

    let service = manager
        .open_service(SERVICE_NAME, ServiceAccess::START)
        .context("Failed to open service")?;

    service
        .start::<OsString>(&[])
        .context("Failed to start service")?;

    info!("Service started successfully");
    Ok(())
}

/// Stop the service
pub fn stop_service() -> Result<()> {
    use std::ffi::OsStr;
    use windows_service::service_manager::{ServiceManager, ServiceManagerAccess};

    info!("Stopping service: {}", SERVICE_NAME);

    let manager = ServiceManager::local_computer(None::<&OsStr>, ServiceManagerAccess::CONNECT)
        .context("Failed to open service manager")?;

    let service = manager
        .open_service(SERVICE_NAME, ServiceAccess::STOP)
        .context("Failed to open service")?;

    service
        .stop()
        .context("Failed to stop service")?;

    info!("Service stopped successfully");
    Ok(())
}
