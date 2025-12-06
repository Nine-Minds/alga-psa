//! Alga Remote Desktop Windows Service
//!
//! This service runs as LocalSystem in Session 0 to provide:
//! - Screen capture from Secure Desktop (UAC prompts, lock screen)
//! - Input injection on secure desktops
//! - Pre-login screen capture and control
//!
//! The service communicates with user-mode agents via named pipe:
//! `\\.\pipe\alga-remote-desktop-service`
//!
//! # Usage
//!
//! Install the service:
//! ```cmd
//! alga-remote-desktop-service.exe install
//! ```
//!
//! Start the service:
//! ```cmd
//! alga-remote-desktop-service.exe start
//! ```
//!
//! Stop the service:
//! ```cmd
//! alga-remote-desktop-service.exe stop
//! ```
//!
//! Uninstall the service:
//! ```cmd
//! alga-remote-desktop-service.exe uninstall
//! ```
//!
//! Run in console mode (for debugging):
//! ```cmd
//! alga-remote-desktop-service.exe console
//! ```

use std::ffi::OsString;

use anyhow::Result;
use tracing::{error, info};

mod capture;
mod desktop;
mod ipc;
mod pipe_server;
mod service;

use service::{
    install_service, run_service, start_service, stop_service, uninstall_service, SERVICE_NAME,
};

// Define the Windows service entry point
windows_service::define_windows_service!(ffi_service_main, service_main);

fn service_main(arguments: Vec<OsString>) {
    if let Err(e) = run_service(arguments) {
        error!("Service error: {:?}", e);
    }
}

fn main() -> Result<()> {
    // Initialize logging for console mode
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::from_default_env()
                .add_directive("rd_service=info".parse().unwrap()),
        )
        .init();

    // Parse command line arguments
    let args: Vec<String> = std::env::args().collect();

    if args.len() < 2 {
        // No arguments - run as service
        info!("Starting as Windows service...");
        windows_service::service_dispatcher::start(SERVICE_NAME, ffi_service_main)?;
        return Ok(());
    }

    let command = args[1].to_lowercase();
    match command.as_str() {
        "install" => {
            info!("Installing service...");
            install_service()?;
            println!("Service installed successfully.");
            println!("Start the service with: {} start", args[0]);
        }

        "uninstall" => {
            info!("Uninstalling service...");
            // Try to stop first
            let _ = stop_service();
            uninstall_service()?;
            println!("Service uninstalled successfully.");
        }

        "start" => {
            info!("Starting service...");
            start_service()?;
            println!("Service started successfully.");
        }

        "stop" => {
            info!("Stopping service...");
            stop_service()?;
            println!("Service stopped successfully.");
        }

        "restart" => {
            info!("Restarting service...");
            let _ = stop_service();
            std::thread::sleep(std::time::Duration::from_secs(2));
            start_service()?;
            println!("Service restarted successfully.");
        }

        "console" | "debug" => {
            info!("Running in console mode (press Ctrl+C to stop)...");
            run_console_mode()?;
        }

        "status" => {
            print_service_status()?;
        }

        "help" | "-h" | "--help" => {
            print_help(&args[0]);
        }

        _ => {
            eprintln!("Unknown command: {}", command);
            print_help(&args[0]);
            std::process::exit(1);
        }
    }

    Ok(())
}

/// Run in console mode for debugging
fn run_console_mode() -> Result<()> {
    use tokio::sync::mpsc;

    info!("Starting console mode...");

    // Create the async runtime
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()?;

    runtime.block_on(async {
        // Create command channel
        let (cmd_tx, mut cmd_rx) = mpsc::channel::<service::ServiceCommand>(16);

        // Start the pipe server
        let pipe_server = pipe_server::PipeServer::new().await?;
        let pipe_handle = pipe_server.start().await?;

        // Start the desktop monitor
        let desktop_monitor = desktop::DesktopMonitor::new(cmd_tx.clone());
        let monitor_handle = desktop_monitor.start().await?;

        info!("Service running in console mode. Press Ctrl+C to stop.");

        // Handle Ctrl+C
        let cmd_tx_clone = cmd_tx.clone();
        tokio::spawn(async move {
            tokio::signal::ctrl_c().await.ok();
            info!("Received Ctrl+C, stopping...");
            let _ = cmd_tx_clone.send(service::ServiceCommand::Stop).await;
        });

        // Main loop
        loop {
            if let Some(cmd) = cmd_rx.recv().await {
                match cmd {
                    service::ServiceCommand::Stop | service::ServiceCommand::Shutdown => {
                        break;
                    }
                    service::ServiceCommand::SessionChange(event) => {
                        info!("Session change: {:?}", event);
                        pipe_server.notify_session_change(event).await;
                    }
                    _ => {}
                }
            }
        }

        // Clean up
        pipe_handle.abort();
        monitor_handle.abort();

        Ok::<(), anyhow::Error>(())
    })?;

    info!("Console mode stopped.");
    Ok(())
}

/// Print service status
fn print_service_status() -> Result<()> {
    use std::ffi::OsStr;
    use windows_service::service::ServiceAccess;
    use windows_service::service_manager::{ServiceManager, ServiceManagerAccess};

    let manager = ServiceManager::local_computer(None::<&OsStr>, ServiceManagerAccess::CONNECT)?;

    match manager.open_service(SERVICE_NAME, ServiceAccess::QUERY_STATUS) {
        Ok(service) => {
            let status = service.query_status()?;
            println!("Service: {}", SERVICE_NAME);
            println!("Status:  {:?}", status.current_state);
            println!("PID:     {:?}", status.process_id);
        }
        Err(_) => {
            println!("Service: {}", SERVICE_NAME);
            println!("Status:  Not installed");
        }
    }

    Ok(())
}

/// Print help message
fn print_help(program: &str) {
    println!(
        r#"Alga Remote Desktop Windows Service

USAGE:
    {} <COMMAND>

COMMANDS:
    install     Install the Windows service
    uninstall   Uninstall the Windows service
    start       Start the service
    stop        Stop the service
    restart     Restart the service
    status      Show service status
    console     Run in console mode (for debugging)
    help        Show this help message

DESCRIPTION:
    This service runs as LocalSystem in Session 0 to enable:
    - Screen capture from Secure Desktop (UAC prompts, lock screen)
    - Input injection on secure desktops
    - Pre-login screen capture and control

    User-mode agents connect via named pipe:
    \\.\pipe\alga-remote-desktop-service

EXAMPLES:
    Install and start the service:
        {} install
        {} start

    Debug the service in console mode:
        {} console

    Check service status:
        {} status
"#,
        program, program, program, program, program
    );
}
