/**
 * Remote Desktop Agent FFI Header
 *
 * This header file defines the C interface for the Remote Desktop Agent
 * Rust library. It is used by the Swift bridging header to call Rust functions.
 */

#ifndef RD_AGENT_H
#define RD_AGENT_H

#include <stdint.h>
#include <stdbool.h>

#ifdef __cplusplus
extern "C" {
#endif

/**
 * Opaque handle to the agent runtime.
 * Created by rd_agent_create() and destroyed by rd_agent_destroy().
 */
typedef struct AgentHandle AgentHandle;

/**
 * Result codes for FFI functions.
 */
typedef enum {
    RD_AGENT_SUCCESS = 0,
    RD_AGENT_INVALID_CONFIG = 1,
    RD_AGENT_INITIALIZATION_FAILED = 2,
    RD_AGENT_CONNECTION_FAILED = 3,
    RD_AGENT_NOT_CONNECTED = 4,
    RD_AGENT_INVALID_ARGUMENT = 5,
    RD_AGENT_INTERNAL_ERROR = 6,
} AgentResult;

/**
 * Callback for signaling events.
 *
 * @param event_type The type of event (e.g., "connected", "session_request", "offer")
 * @param session_id The session ID (may be empty for some events)
 * @param payload Additional event data (e.g., engineer_id, SDP)
 * @param context User context passed to rd_agent_connect()
 */
typedef void (*SignalingEventCallback)(
    const char* event_type,
    const char* session_id,
    const char* payload,
    void* context
);

/**
 * Callback for captured frames.
 *
 * @param data Pointer to JPEG-encoded frame data
 * @param length Length of the frame data in bytes
 * @param width Frame width in pixels
 * @param height Frame height in pixels
 * @param context User context passed to rd_agent_start_capture()
 */
typedef void (*FrameCallback)(
    const uint8_t* data,
    size_t length,
    uint32_t width,
    uint32_t height,
    void* context
);

/**
 * Initialize logging for the Rust library.
 * Should be called once at application startup.
 */
void rd_agent_init_logging(void);

/**
 * Create a new agent handle with the given configuration.
 *
 * @param config_json JSON string containing the configuration
 * @return Pointer to the agent handle, or NULL on failure
 *
 * The configuration JSON should have the following structure:
 * {
 *   "agent": {
 *     "agent_id": "uuid",
 *     "agent_name": "My Computer",
 *     "connection_token": "token"
 *   },
 *   "server": {
 *     "signaling_url": "wss://...",
 *     "api_url": "https://..."
 *   },
 *   "capture": {
 *     "fps": 30,
 *     "quality": 80,
 *     "max_width": 1920,
 *     "max_height": 1080
 *   },
 *   "network": {
 *     "stun_servers": ["stun:stun.l.google.com:19302"],
 *     "reconnect_interval_ms": 5000,
 *     "max_reconnect_attempts": 10
 *   },
 *   "logging": {
 *     "level": "info",
 *     "file": ""
 *   }
 * }
 */
AgentHandle* rd_agent_create(const char* config_json);

/**
 * Connect to the signaling server.
 *
 * @param handle The agent handle
 * @param callback Callback function for signaling events
 * @param context User context passed to the callback
 * @return AgentResult indicating success or failure
 */
AgentResult rd_agent_connect(
    AgentHandle* handle,
    SignalingEventCallback callback,
    void* context
);

/**
 * Accept a session request.
 *
 * @param handle The agent handle
 * @param session_id The session ID to accept
 * @return AgentResult indicating success or failure
 */
AgentResult rd_agent_accept_session(
    AgentHandle* handle,
    const char* session_id
);

/**
 * Deny a session request.
 *
 * @param handle The agent handle
 * @param session_id The session ID to deny
 * @return AgentResult indicating success or failure
 */
AgentResult rd_agent_deny_session(
    AgentHandle* handle,
    const char* session_id
);

/**
 * Inject an input event.
 *
 * @param handle The agent handle
 * @param event_json JSON string containing the input event
 * @return AgentResult indicating success or failure
 *
 * Input event JSON examples:
 * - Mouse move: {"type": "MouseMove", "x": 100, "y": 200}
 * - Mouse down: {"type": "MouseDown", "button": "left"}
 * - Mouse up: {"type": "MouseUp", "button": "left"}
 * - Mouse scroll: {"type": "MouseScroll", "delta_x": 0, "delta_y": -120}
 * - Key down: {"type": "KeyDown", "key": "a"}
 * - Key up: {"type": "KeyUp", "key": "a"}
 */
AgentResult rd_agent_inject_input(
    AgentHandle* handle,
    const char* event_json
);

/**
 * Start screen capture.
 *
 * @param handle The agent handle
 * @param callback Callback function for captured frames
 * @param context User context passed to the callback
 * @return AgentResult indicating success or failure
 */
AgentResult rd_agent_start_capture(
    AgentHandle* handle,
    FrameCallback callback,
    void* context
);

/**
 * Get agent information as JSON.
 *
 * @param handle The agent handle
 * @return JSON string containing agent info, or NULL on failure.
 *         The caller must free the returned string with rd_agent_free_string().
 */
char* rd_agent_get_info(const AgentHandle* handle);

/**
 * Check if the required macOS permissions are granted.
 *
 * @return JSON string with permission status:
 *         {"screen_recording": bool, "accessibility": bool}
 *         The caller must free the returned string with rd_agent_free_string().
 */
char* rd_agent_check_permissions(void);

/**
 * Free a string returned by the library.
 *
 * @param s String to free (may be NULL)
 */
void rd_agent_free_string(char* s);

/**
 * Destroy the agent handle and free resources.
 *
 * @param handle The agent handle to destroy (may be NULL)
 */
void rd_agent_destroy(AgentHandle* handle);

#ifdef __cplusplus
}
#endif

#endif /* RD_AGENT_H */
