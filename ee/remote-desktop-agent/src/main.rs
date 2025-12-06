//! Remote Desktop Agent for Alga PSA
//!
//! This agent runs on client machines and provides remote desktop capabilities
//! through WebRTC-based screen sharing and input injection.

mod config;
mod capture;
mod input;
mod signaling;

use anyhow::Result;
use log::{error, info, warn};
use std::env;
use std::process;
use std::sync::Arc;
use tokio::sync::{mpsc, Mutex};

use config::Config;
use capture::{ScreenCapturer, FrameProducer};
use input::{InputController, InputEvent};
use signaling::{SignalingClient, SignalingEvent};

/// Application state
struct AppState {
    config: Config,
    input_controller: Arc<Mutex<InputController>>,
    active_session: Arc<Mutex<Option<String>>>,
}

#[tokio::main]
async fn main() {
    // Initialize logging
    init_logging();

    info!("Starting Remote Desktop Agent v{}", env!("CARGO_PKG_VERSION"));

    // Parse command line arguments
    let args: Vec<String> = env::args().collect();
    let config_path = args.get(1).map(|s| s.as_str()).unwrap_or("config.toml");

    // Load configuration
    let config = match Config::load(config_path) {
        Ok(cfg) => cfg,
        Err(e) => {
            error!("Failed to load configuration: {}", e);
            error!("Please ensure config.toml exists and contains valid settings.");
            error!("If this is a new installation, run the registration process first.");
            process::exit(1);
        }
    };

    info!("Configuration loaded");
    info!("Agent ID: {}", config.agent.agent_id);
    info!("Agent Name: {}", config.agent.agent_name);
    info!("Signaling URL: {}", config.server.signaling_url);

    // Initialize input controller
    let input_controller = match InputController::new() {
        Ok(ctrl) => Arc::new(Mutex::new(ctrl)),
        Err(e) => {
            error!("Failed to initialize input controller: {}", e);
            process::exit(1);
        }
    };

    // Create application state
    let state = Arc::new(AppState {
        config: config.clone(),
        input_controller,
        active_session: Arc::new(Mutex::new(None)),
    });

    // Run the main application loop
    if let Err(e) = run(state).await {
        error!("Application error: {}", e);
        process::exit(1);
    }
}

/// Initialize logging based on configuration or environment
fn init_logging() {
    // Use env_logger with defaults
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info"))
        .format_timestamp_millis()
        .init();
}

/// Main application loop
async fn run(state: Arc<AppState>) -> Result<()> {
    // Create channel for signaling events
    let (event_tx, mut event_rx) = mpsc::channel::<SignalingEvent>(32);

    // Create signaling client
    let signaling_client = Arc::new(SignalingClient::new(
        state.config.server.signaling_url.clone(),
        state.config.agent.connection_token.clone(),
        event_tx,
        state.config.network.reconnect_interval_ms,
        state.config.network.max_reconnect_attempts,
    ));

    // Spawn signaling connection task
    let signaling_handle = {
        let client = Arc::clone(&signaling_client);
        tokio::spawn(async move {
            if let Err(e) = client.connect().await {
                error!("Signaling connection failed: {}", e);
            }
        })
    };

    // Main event loop
    info!("Entering main event loop");

    loop {
        tokio::select! {
            // Handle signaling events
            Some(event) = event_rx.recv() => {
                handle_signaling_event(
                    event,
                    Arc::clone(&state),
                    Arc::clone(&signaling_client),
                ).await;
            }

            // Handle Ctrl+C
            _ = tokio::signal::ctrl_c() => {
                info!("Received shutdown signal");
                break;
            }
        }
    }

    // Clean up
    info!("Shutting down...");
    signaling_handle.abort();

    Ok(())
}

/// Handle signaling events
async fn handle_signaling_event(
    event: SignalingEvent,
    state: Arc<AppState>,
    signaling_client: Arc<SignalingClient>,
) {
    match event {
        SignalingEvent::Connected => {
            info!("Connected to signaling server");
        }

        SignalingEvent::Disconnected => {
            warn!("Disconnected from signaling server");
            // Clear active session
            let mut session = state.active_session.lock().await;
            *session = None;
        }

        SignalingEvent::Error(msg) => {
            error!("Signaling error: {}", msg);
        }

        SignalingEvent::SessionRequest { session_id, engineer_id } => {
            info!("Session request from engineer {} (session: {})", engineer_id, session_id);

            // For Phase 1, auto-accept all session requests
            // In a production system, this would show a consent dialog to the user
            info!("Auto-accepting session request (Phase 1)");

            // Store active session
            {
                let mut session = state.active_session.lock().await;
                *session = Some(session_id.clone());
            }

            // Accept the session
            if let Err(e) = signaling_client.accept_session(&session_id).await {
                error!("Failed to accept session: {}", e);
            }
        }

        SignalingEvent::Offer { session_id, sdp } => {
            info!("Received WebRTC offer for session: {}", session_id);

            // TODO: Create WebRTC peer connection and handle the offer
            // This is where we would:
            // 1. Create a new RTCPeerConnection
            // 2. Set the remote description (offer)
            // 3. Create an answer
            // 4. Set the local description
            // 5. Start sending screen frames
            // 6. Set up data channel for input events

            // For now, log that we received it
            info!("WebRTC offer received, SDP length: {} bytes", sdp.len());

            // TODO: Implement WebRTC handling in Phase 1 completion
            warn!("WebRTC peer connection not yet implemented");
        }

        SignalingEvent::Answer { session_id, sdp } => {
            // This shouldn't happen for agents (agents receive offers, send answers)
            warn!("Unexpected answer received for session: {}", session_id);
        }

        SignalingEvent::IceCandidate { session_id, candidate } => {
            info!("Received ICE candidate for session: {}", session_id);
            // TODO: Add ICE candidate to peer connection
        }
    }
}

// TODO: In the full implementation, we would have:
// - WebRTC peer connection management
// - Screen capture loop that sends frames via data channel
// - Input event handler that receives events via data channel
// - Frame encoding and transmission
// - Connection quality monitoring
// - Error recovery and reconnection logic
