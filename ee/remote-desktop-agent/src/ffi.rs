//! FFI Layer for Swift Integration
//!
//! This module provides C-compatible functions that can be called from Swift
//! via a bridging header. The Swift app handles the UI and permissions,
//! while this Rust library handles the core remote desktop functionality.

use std::ffi::{CStr, CString};
use std::os::raw::c_char;
use std::ptr;
use std::sync::Arc;

use log::{error, info, warn};
use tokio::runtime::Runtime;
use tokio::sync::{mpsc, Mutex};

use crate::config::Config;
use crate::capture::{ScreenCapturer, CapturedFrame};
use crate::input::{InputController, InputEvent};
use crate::signaling::{SignalingClient, SignalingEvent};

/// Opaque handle to the agent runtime
pub struct AgentHandle {
    runtime: Runtime,
    config: Config,
    input_controller: Arc<Mutex<InputController>>,
    signaling_client: Option<Arc<SignalingClient>>,
    event_rx: Option<mpsc::Receiver<SignalingEvent>>,
    active_session: Arc<Mutex<Option<String>>>,
}

/// Result codes for FFI functions
#[repr(C)]
pub enum AgentResult {
    Success = 0,
    InvalidConfig = 1,
    InitializationFailed = 2,
    ConnectionFailed = 3,
    NotConnected = 4,
    InvalidArgument = 5,
    InternalError = 6,
}

/// Callback for signaling events (called from Rust to Swift)
pub type SignalingEventCallback = extern "C" fn(
    event_type: *const c_char,
    session_id: *const c_char,
    payload: *const c_char,
    context: *mut std::ffi::c_void,
);

/// Callback for captured frames (called from Rust to Swift)
pub type FrameCallback = extern "C" fn(
    data: *const u8,
    length: usize,
    width: u32,
    height: u32,
    context: *mut std::ffi::c_void,
);

/// Initialize logging for the Rust library
///
/// # Safety
/// This function is safe to call from Swift.
#[no_mangle]
pub extern "C" fn rd_agent_init_logging() {
    // Initialize logging with a filter that can be controlled by RUST_LOG env var
    let _ = env_logger::Builder::from_env(
        env_logger::Env::default().default_filter_or("info")
    )
    .format_timestamp_millis()
    .try_init();

    info!("Remote Desktop Agent library initialized");
}

/// Create a new agent handle with the given configuration
///
/// # Arguments
/// * `config_json` - JSON string containing the configuration
///
/// # Returns
/// A pointer to the agent handle, or null on failure
///
/// # Safety
/// The caller must ensure `config_json` is a valid null-terminated C string.
/// The returned handle must be freed with `rd_agent_destroy`.
#[no_mangle]
pub unsafe extern "C" fn rd_agent_create(config_json: *const c_char) -> *mut AgentHandle {
    if config_json.is_null() {
        error!("rd_agent_create: config_json is null");
        return ptr::null_mut();
    }

    let config_str = match CStr::from_ptr(config_json).to_str() {
        Ok(s) => s,
        Err(e) => {
            error!("rd_agent_create: invalid UTF-8 in config_json: {}", e);
            return ptr::null_mut();
        }
    };

    // Parse config from JSON
    let config: Config = match serde_json::from_str(config_str) {
        Ok(c) => c,
        Err(e) => {
            error!("rd_agent_create: failed to parse config JSON: {}", e);
            return ptr::null_mut();
        }
    };

    // Create Tokio runtime
    let runtime = match Runtime::new() {
        Ok(rt) => rt,
        Err(e) => {
            error!("rd_agent_create: failed to create Tokio runtime: {}", e);
            return ptr::null_mut();
        }
    };

    // Initialize input controller
    let input_controller = match InputController::new() {
        Ok(ctrl) => Arc::new(Mutex::new(ctrl)),
        Err(e) => {
            error!("rd_agent_create: failed to create input controller: {}", e);
            return ptr::null_mut();
        }
    };

    let handle = Box::new(AgentHandle {
        runtime,
        config,
        input_controller,
        signaling_client: None,
        event_rx: None,
        active_session: Arc::new(Mutex::new(None)),
    });

    info!("Agent handle created successfully");
    Box::into_raw(handle)
}

/// Connect to the signaling server
///
/// # Arguments
/// * `handle` - The agent handle
/// * `callback` - Callback function for signaling events
/// * `context` - User context passed to the callback
///
/// # Returns
/// AgentResult indicating success or failure
///
/// # Safety
/// The caller must ensure `handle` is a valid pointer created by `rd_agent_create`.
#[no_mangle]
pub unsafe extern "C" fn rd_agent_connect(
    handle: *mut AgentHandle,
    callback: SignalingEventCallback,
    context: *mut std::ffi::c_void,
) -> AgentResult {
    if handle.is_null() {
        error!("rd_agent_connect: handle is null");
        return AgentResult::InvalidArgument;
    }

    let handle = &mut *handle;

    // Create channel for signaling events
    let (event_tx, event_rx) = mpsc::channel::<SignalingEvent>(32);
    handle.event_rx = Some(event_rx);

    // Create signaling client
    let signaling_client = Arc::new(SignalingClient::new(
        handle.config.server.signaling_url.clone(),
        handle.config.agent.connection_token.clone(),
        event_tx,
        handle.config.network.reconnect_interval_ms,
        handle.config.network.max_reconnect_attempts,
    ));
    handle.signaling_client = Some(Arc::clone(&signaling_client));

    // Spawn signaling connection task
    let client = Arc::clone(&signaling_client);
    handle.runtime.spawn(async move {
        if let Err(e) = client.connect().await {
            error!("Signaling connection failed: {}", e);
        }
    });

    // Spawn event handling task
    if let Some(mut event_rx) = handle.event_rx.take() {
        let active_session = Arc::clone(&handle.active_session);
        let signaling_client = Arc::clone(&signaling_client);

        handle.runtime.spawn(async move {
            while let Some(event) = event_rx.recv().await {
                // Convert event to C strings for callback
                let (event_type, session_id, payload) = match &event {
                    SignalingEvent::Connected => {
                        ("connected".to_string(), String::new(), String::new())
                    }
                    SignalingEvent::Disconnected => {
                        let mut session = active_session.lock().await;
                        *session = None;
                        ("disconnected".to_string(), String::new(), String::new())
                    }
                    SignalingEvent::Error(msg) => {
                        ("error".to_string(), String::new(), msg.clone())
                    }
                    SignalingEvent::SessionRequest { session_id, engineer_id } => {
                        ("session_request".to_string(), session_id.clone(), engineer_id.clone())
                    }
                    SignalingEvent::Offer { session_id, sdp } => {
                        ("offer".to_string(), session_id.clone(), sdp.clone())
                    }
                    SignalingEvent::Answer { session_id, sdp } => {
                        ("answer".to_string(), session_id.clone(), sdp.clone())
                    }
                    SignalingEvent::IceCandidate { session_id, candidate } => {
                        ("ice_candidate".to_string(), session_id.clone(), candidate.to_string())
                    }
                };

                // Call the Swift callback
                let event_type_c = CString::new(event_type).unwrap_or_default();
                let session_id_c = CString::new(session_id).unwrap_or_default();
                let payload_c = CString::new(payload).unwrap_or_default();

                callback(
                    event_type_c.as_ptr(),
                    session_id_c.as_ptr(),
                    payload_c.as_ptr(),
                    context,
                );
            }
        });
    }

    info!("Agent connected to signaling server");
    AgentResult::Success
}

/// Accept a session request
///
/// # Arguments
/// * `handle` - The agent handle
/// * `session_id` - The session ID to accept
///
/// # Returns
/// AgentResult indicating success or failure
///
/// # Safety
/// The caller must ensure `handle` and `session_id` are valid pointers.
#[no_mangle]
pub unsafe extern "C" fn rd_agent_accept_session(
    handle: *mut AgentHandle,
    session_id: *const c_char,
) -> AgentResult {
    if handle.is_null() || session_id.is_null() {
        return AgentResult::InvalidArgument;
    }

    let handle = &mut *handle;
    let session_id = match CStr::from_ptr(session_id).to_str() {
        Ok(s) => s.to_string(),
        Err(_) => return AgentResult::InvalidArgument,
    };

    let signaling_client = match &handle.signaling_client {
        Some(c) => Arc::clone(c),
        None => return AgentResult::NotConnected,
    };

    // Store active session
    let active_session = Arc::clone(&handle.active_session);
    let session_id_clone = session_id.clone();

    handle.runtime.block_on(async {
        let mut session = active_session.lock().await;
        *session = Some(session_id_clone);
    });

    // Accept the session
    let result = handle.runtime.block_on(async {
        signaling_client.accept_session(&session_id).await
    });

    match result {
        Ok(_) => {
            info!("Session {} accepted", session_id);
            AgentResult::Success
        }
        Err(e) => {
            error!("Failed to accept session: {}", e);
            AgentResult::InternalError
        }
    }
}

/// Deny a session request
///
/// # Arguments
/// * `handle` - The agent handle
/// * `session_id` - The session ID to deny
///
/// # Returns
/// AgentResult indicating success or failure
///
/// # Safety
/// The caller must ensure `handle` and `session_id` are valid pointers.
#[no_mangle]
pub unsafe extern "C" fn rd_agent_deny_session(
    handle: *mut AgentHandle,
    session_id: *const c_char,
) -> AgentResult {
    if handle.is_null() || session_id.is_null() {
        return AgentResult::InvalidArgument;
    }

    let handle = &mut *handle;
    let session_id = match CStr::from_ptr(session_id).to_str() {
        Ok(s) => s.to_string(),
        Err(_) => return AgentResult::InvalidArgument,
    };

    let signaling_client = match &handle.signaling_client {
        Some(c) => Arc::clone(c),
        None => return AgentResult::NotConnected,
    };

    let result = handle.runtime.block_on(async {
        signaling_client.deny_session(&session_id).await
    });

    match result {
        Ok(_) => {
            info!("Session {} denied", session_id);
            AgentResult::Success
        }
        Err(e) => {
            error!("Failed to deny session: {}", e);
            AgentResult::InternalError
        }
    }
}

/// Inject an input event
///
/// # Arguments
/// * `handle` - The agent handle
/// * `event_json` - JSON string containing the input event
///
/// # Returns
/// AgentResult indicating success or failure
///
/// # Safety
/// The caller must ensure `handle` and `event_json` are valid pointers.
#[no_mangle]
pub unsafe extern "C" fn rd_agent_inject_input(
    handle: *mut AgentHandle,
    event_json: *const c_char,
) -> AgentResult {
    if handle.is_null() || event_json.is_null() {
        return AgentResult::InvalidArgument;
    }

    let handle = &*handle;
    let event_str = match CStr::from_ptr(event_json).to_str() {
        Ok(s) => s,
        Err(_) => return AgentResult::InvalidArgument,
    };

    let event: InputEvent = match serde_json::from_str(event_str) {
        Ok(e) => e,
        Err(e) => {
            error!("Failed to parse input event: {}", e);
            return AgentResult::InvalidArgument;
        }
    };

    let input_controller = Arc::clone(&handle.input_controller);
    let result = handle.runtime.block_on(async {
        let mut controller = input_controller.lock().await;
        controller.handle_event(event)
    });

    match result {
        Ok(_) => AgentResult::Success,
        Err(e) => {
            error!("Failed to inject input: {}", e);
            AgentResult::InternalError
        }
    }
}

/// Start screen capture
///
/// # Arguments
/// * `handle` - The agent handle
/// * `callback` - Callback function for captured frames
/// * `context` - User context passed to the callback
///
/// # Returns
/// AgentResult indicating success or failure
///
/// # Safety
/// The caller must ensure `handle` is a valid pointer.
#[no_mangle]
pub unsafe extern "C" fn rd_agent_start_capture(
    handle: *mut AgentHandle,
    callback: FrameCallback,
    context: *mut std::ffi::c_void,
) -> AgentResult {
    if handle.is_null() {
        return AgentResult::InvalidArgument;
    }

    let handle = &*handle;

    // Create screen capturer
    let capturer = match ScreenCapturer::new(
        handle.config.capture.quality,
        handle.config.capture.max_width,
        handle.config.capture.max_height,
    ) {
        Ok(c) => c,
        Err(e) => {
            error!("Failed to create screen capturer: {}", e);
            return AgentResult::InitializationFailed;
        }
    };

    let fps = handle.config.capture.fps;

    // Spawn capture task
    handle.runtime.spawn(async move {
        let mut capturer = capturer;
        let frame_duration = std::time::Duration::from_millis(1000 / fps as u64);

        loop {
            let start = std::time::Instant::now();

            match capturer.capture_frame() {
                Ok(frame) => {
                    callback(
                        frame.data.as_ptr(),
                        frame.data.len(),
                        frame.width,
                        frame.height,
                        context,
                    );
                }
                Err(e) => {
                    warn!("Frame capture error: {}", e);
                }
            }

            // Maintain frame rate
            let elapsed = start.elapsed();
            if elapsed < frame_duration {
                tokio::time::sleep(frame_duration - elapsed).await;
            }
        }
    });

    info!("Screen capture started");
    AgentResult::Success
}

/// Get agent information as JSON
///
/// # Arguments
/// * `handle` - The agent handle
///
/// # Returns
/// A JSON string containing agent info, or null on failure.
/// The caller must free the returned string with `rd_agent_free_string`.
///
/// # Safety
/// The caller must ensure `handle` is a valid pointer.
#[no_mangle]
pub unsafe extern "C" fn rd_agent_get_info(handle: *const AgentHandle) -> *mut c_char {
    if handle.is_null() {
        return ptr::null_mut();
    }

    let handle = &*handle;
    let info = serde_json::json!({
        "agent_id": handle.config.agent.agent_id,
        "agent_name": handle.config.agent.agent_name,
        "version": env!("CARGO_PKG_VERSION"),
    });

    match CString::new(info.to_string()) {
        Ok(s) => s.into_raw(),
        Err(_) => ptr::null_mut(),
    }
}

/// Free a string returned by the library
///
/// # Safety
/// The caller must ensure `s` was returned by a library function.
#[no_mangle]
pub unsafe extern "C" fn rd_agent_free_string(s: *mut c_char) {
    if !s.is_null() {
        drop(CString::from_raw(s));
    }
}

/// Destroy the agent handle and free resources
///
/// # Safety
/// The caller must ensure `handle` was created by `rd_agent_create`.
/// After calling this function, the handle is no longer valid.
#[no_mangle]
pub unsafe extern "C" fn rd_agent_destroy(handle: *mut AgentHandle) {
    if !handle.is_null() {
        let handle = Box::from_raw(handle);
        info!("Agent handle destroyed");
        drop(handle);
    }
}

/// Check if the required macOS permissions are granted
///
/// # Returns
/// A JSON string with permission status:
/// {"screen_recording": bool, "accessibility": bool}
///
/// # Safety
/// This function is safe to call from Swift.
#[no_mangle]
#[cfg(target_os = "macos")]
pub extern "C" fn rd_agent_check_permissions() -> *mut c_char {
    use core_graphics::access::ScreenCaptureAccess;

    // Check screen recording permission
    let screen_recording = ScreenCaptureAccess::preflight();

    // Check accessibility permission
    // We use a simple test by trying to create an event source
    let accessibility = {
        use core_graphics::event_source::{CGEventSource, CGEventSourceStateID};
        CGEventSource::new(CGEventSourceStateID::HIDSystemState).is_ok()
    };

    let status = serde_json::json!({
        "screen_recording": screen_recording,
        "accessibility": accessibility,
    });

    match CString::new(status.to_string()) {
        Ok(s) => s.into_raw(),
        Err(_) => ptr::null_mut(),
    }
}
