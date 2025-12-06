# Remote Desktop Support Feature Plan

## Executive Summary

This document outlines the comprehensive plan for building a WebRTC-based remote desktop support system for the Alga PSA platform. The system enables MSP engineers to remotely control client machines (Windows and macOS) through a browser-based interface, with full mouse/keyboard support, terminal access, and enterprise-grade security.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              ALGA PSA SERVER                                 │
│  ┌─────────────────┐  ┌──────────────────┐  ┌─────────────────────────────┐ │
│  │  WebRTC Signal  │  │  TURN/STUN       │  │  Session Management         │ │
│  │  Server         │  │  Server          │  │  & Authentication           │ │
│  └────────┬────────┘  └────────┬─────────┘  └──────────────┬──────────────┘ │
│           │                    │                           │                 │
└───────────┼────────────────────┼───────────────────────────┼─────────────────┘
            │                    │                           │
            │         WebRTC Peer Connection                 │
            │                    │                           │
┌───────────┴────────────────────┴───────────────────────────┴─────────────────┐
│                                                                               │
│  ┌─────────────────────────────┐         ┌─────────────────────────────────┐ │
│  │     REMOTE AGENT            │         │     ENGINEER BROWSER CLIENT    │ │
│  │  (Windows/macOS)            │         │                                 │ │
│  │                             │         │  ┌───────────────────────────┐  │ │
│  │  ┌─────────────────────┐   │         │  │  Desktop Viewer           │  │ │
│  │  │ Screen Capture      │   │◄───────►│  │  (WebRTC Video)           │  │ │
│  │  │ (WebRTC Video)      │   │         │  └───────────────────────────┘  │ │
│  │  └─────────────────────┘   │         │                                 │ │
│  │                             │         │  ┌───────────────────────────┐  │ │
│  │  ┌─────────────────────┐   │         │  │  Input Handler            │  │ │
│  │  │ Input Injection     │◄──┼─────────┤  │  (Mouse/Keyboard)         │  │ │
│  │  │ (Mouse/Keyboard)    │   │         │  └───────────────────────────┘  │ │
│  │  └─────────────────────┘   │         │                                 │ │
│  │                             │         │  ┌───────────────────────────┐  │ │
│  │  ┌─────────────────────┐   │         │  │  xterm.js Terminal        │  │ │
│  │  │ PTY Terminal        │◄──┼─────────┤  │  (Data Channel)           │  │ │
│  │  └─────────────────────┘   │         │  └───────────────────────────┘  │ │
│  │                             │         │                                 │ │
│  │  ┌─────────────────────┐   │         │  ┌───────────────────────────┐  │ │
│  │  │ System Service      │   │         │  │  File Transfer            │  │ │
│  │  │ (UAC/Elevated)      │   │         │  │  (Data Channel)           │  │ │
│  │  └─────────────────────┘   │         │  └───────────────────────────┘  │ │
│  │                             │         │                                 │ │
│  │  ┌─────────────────────┐   │         └─────────────────────────────────┘ │
│  │  │ Local UI (Electron) │   │                                             │
│  │  └─────────────────────┘   │                                             │
│  └─────────────────────────────┘                                             │
│                                                                               │
└───────────────────────────────────────────────────────────────────────────────┘
```

---

# Part 1: Server-Side Components

## 1.1 WebRTC Signaling Server

### Purpose
Facilitates the initial connection establishment between remote agents and engineer clients using WebRTC signaling (SDP offer/answer exchange, ICE candidate exchange).

### Technology Stack
- **Runtime**: Node.js (integrated with existing Alga PSA server)
- **WebSocket Library**: ws or Socket.IO for real-time signaling
- **Protocol**: Custom JSON-based signaling protocol over WSS

### Implementation Details

```typescript
// Signaling message types
interface SignalingMessage {
  type: 'offer' | 'answer' | 'ice-candidate' | 'session-request' | 'session-accept' | 'session-deny';
  sessionId: string;
  senderId: string;
  payload: SDPDescription | ICECandidate | SessionRequest;
  timestamp: number;
  signature: string; // HMAC signature for message integrity
}
```

### Key Features
1. **Session Routing**: Route signaling messages between specific agent-engineer pairs
2. **Session Management**: Track active sessions, handle disconnections gracefully
3. **Rate Limiting**: Prevent signaling abuse
4. **Message Queuing**: Queue messages for temporarily disconnected peers

### Security Considerations
- All signaling over WSS (TLS 1.3)
- Message authentication using HMAC-SHA256
- Session tokens with short TTL
- IP allowlisting for enterprise deployments

---

## 1.2 TURN/STUN Server

### Purpose
Enable NAT traversal for WebRTC connections. STUN discovers public IP/port; TURN relays media when direct connection fails.

### Deployment Options

#### Option A: Self-Hosted (Recommended for Enterprise)
- **Software**: coturn (open-source, battle-tested)
- **Deployment**: Kubernetes pods with geographic distribution

```yaml
# Example coturn configuration
listening-port=3478
tls-listening-port=5349
realm=alga-psa.example.com
server-name=turn.alga-psa.example.com
fingerprint
lt-cred-mech
use-auth-secret
static-auth-secret=${TURN_SECRET}
total-quota=100
stale-nonce=600
cert=/etc/ssl/turn_server_cert.pem
pkey=/etc/ssl/turn_server_pkey.pem
cipher-list="ECDHE-RSA-AES256-GCM-SHA384:ECDHE-RSA-AES128-GCM-SHA256"
no-tlsv1
no-tlsv1_1
```

#### Option B: Managed Service
- Twilio Network Traversal Service
- Xirsys
- Google Cloud's TURN relay

### Capacity Planning
- Estimate 500 Kbps per active session (1080p desktop stream)
- Plan for 10% of connections requiring TURN relay
- Geographic distribution to minimize latency

---

## 1.3 Session Management & Authentication

### Session Lifecycle

```
┌─────────────┐    ┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│  REQUESTED  │───►│  PENDING    │───►│  ACTIVE     │───►│  ENDED      │
│             │    │  (awaiting  │    │             │    │             │
│             │    │  user       │    │             │    │             │
│             │    │  consent)   │    │             │    │             │
└─────────────┘    └─────────────┘    └─────────────┘    └─────────────┘
                          │                  │
                          ▼                  ▼
                   ┌─────────────┐    ┌─────────────┐
                   │  DENIED     │    │  FAILED     │
                   └─────────────┘    └─────────────┘
```

### Database Schema

```sql
CREATE TABLE remote_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  agent_id UUID NOT NULL REFERENCES remote_agents(id),
  engineer_user_id UUID NOT NULL REFERENCES users(id),

  -- Session state
  status VARCHAR(20) NOT NULL DEFAULT 'requested',
  started_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  end_reason VARCHAR(50),

  -- Connection details
  connection_type VARCHAR(20), -- 'direct' or 'relayed'
  client_ip INET,

  -- Audit fields
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT valid_status CHECK (status IN ('requested', 'pending', 'active', 'ended', 'denied', 'failed'))
);

CREATE TABLE remote_agents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  company_id UUID REFERENCES companies(id),

  -- Agent identification
  machine_id VARCHAR(255) NOT NULL, -- Hardware-derived unique ID
  hostname VARCHAR(255),
  os_type VARCHAR(20) NOT NULL, -- 'windows' or 'macos'
  os_version VARCHAR(100),
  agent_version VARCHAR(50),

  -- Connectivity
  last_seen_at TIMESTAMPTZ,
  is_online BOOLEAN DEFAULT false,
  current_user VARCHAR(255), -- Currently logged-in user

  -- Security
  public_key_fingerprint VARCHAR(64),
  enrollment_code_hash VARCHAR(64),
  enrolled_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE(tenant_id, machine_id)
);

CREATE TABLE session_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES remote_sessions(id),
  event_type VARCHAR(50) NOT NULL,
  event_data JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX idx_remote_sessions_tenant ON remote_sessions(tenant_id);
CREATE INDEX idx_remote_sessions_agent ON remote_sessions(agent_id);
CREATE INDEX idx_remote_sessions_status ON remote_sessions(status);
CREATE INDEX idx_remote_agents_tenant ON remote_agents(tenant_id);
CREATE INDEX idx_remote_agents_online ON remote_agents(tenant_id, is_online);
```

### Authentication Flow

```
Engineer                    Server                      Agent
   │                          │                           │
   │  1. Request Session      │                           │
   │  (JWT + agent_id)        │                           │
   │─────────────────────────►│                           │
   │                          │  2. Validate JWT          │
   │                          │  3. Check permissions     │
   │                          │  4. Generate session      │
   │                          │     token (short-lived)   │
   │                          │                           │
   │                          │  5. Notify agent          │
   │                          │─────────────────────────►│
   │                          │                           │
   │                          │  6. Agent accepts/denies  │
   │                          │◄─────────────────────────│
   │                          │                           │
   │  7. Session approved     │                           │
   │  (session token +        │                           │
   │   TURN credentials)      │                           │
   │◄─────────────────────────│                           │
   │                          │                           │
   │  8. WebRTC signaling begins                          │
   │◄────────────────────────────────────────────────────►│
```

### Permission Model

```typescript
interface RemoteAccessPermission {
  canConnect: boolean;
  canViewScreen: boolean;
  canControlInput: boolean;
  canAccessTerminal: boolean;
  canTransferFiles: boolean;
  canElevate: boolean; // UAC elevation
  requiresUserConsent: boolean;
  sessionDurationLimit?: number; // minutes
  allowedTimeWindows?: TimeWindow[];
}

// Permission levels mapped to roles
const PERMISSION_LEVELS = {
  'technician': {
    canConnect: true,
    canViewScreen: true,
    canControlInput: true,
    canAccessTerminal: true,
    canTransferFiles: true,
    canElevate: false,
    requiresUserConsent: true,
  },
  'senior_technician': {
    canConnect: true,
    canViewScreen: true,
    canControlInput: true,
    canAccessTerminal: true,
    canTransferFiles: true,
    canElevate: true,
    requiresUserConsent: true,
  },
  'admin': {
    canConnect: true,
    canViewScreen: true,
    canControlInput: true,
    canAccessTerminal: true,
    canTransferFiles: true,
    canElevate: true,
    requiresUserConsent: false, // Unattended access
  },
};
```

---

## 1.4 Server API Endpoints

### REST API

```typescript
// Agent Management
GET    /api/remote/agents                    // List agents for tenant
GET    /api/remote/agents/:id                // Get agent details
DELETE /api/remote/agents/:id                // Remove agent
POST   /api/remote/agents/:id/wake           // Wake-on-LAN (if supported)

// Session Management
POST   /api/remote/sessions                  // Request new session
GET    /api/remote/sessions/:id              // Get session details
DELETE /api/remote/sessions/:id              // End session
GET    /api/remote/sessions/:id/events       // Get session event log

// Enrollment
POST   /api/remote/enrollment-codes          // Generate enrollment code
GET    /api/remote/enrollment-codes/:code    // Validate code (agent-side)
POST   /api/remote/agents/enroll             // Complete enrollment
```

### WebSocket Events

```typescript
// Server -> Engineer Client
'agent:online'          // Agent came online
'agent:offline'         // Agent went offline
'session:pending'       // Waiting for user consent
'session:approved'      // Session approved, begin WebRTC
'session:denied'        // User denied session
'session:ended'         // Session ended

// Server -> Agent
'session:request'       // New session request
'session:end'           // Server ending session
```

---

# Part 2: Remote Agent (Windows & macOS)

## 2.1 Agent Architecture

### Core Design Principles
1. **Lightweight**: Minimal resource footprint (<50MB RAM idle, <5% CPU)
2. **Secure**: Minimal attack surface, principle of least privilege
3. **Reliable**: Auto-restart, crash recovery, health monitoring
4. **Updatable**: Silent background updates with rollback capability

### Component Structure

```
┌─────────────────────────────────────────────────────────────────┐
│                        REMOTE AGENT                              │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │                    RUST CORE                                │ │
│  │  ┌─────────────┐ ┌─────────────┐ ┌─────────────────────┐   │ │
│  │  │ WebRTC      │ │ Screen      │ │ Input Injection     │   │ │
│  │  │ (webrtc-rs) │ │ Capture     │ │ (platform-specific) │   │ │
│  │  └─────────────┘ └─────────────┘ └─────────────────────────┘ │
│  │  ┌─────────────┐ ┌─────────────┐ ┌─────────────────────┐   │ │
│  │  │ PTY         │ │ Signaling   │ │ File Transfer       │   │ │
│  │  │ Terminal    │ │ Client      │ │ Handler             │   │ │
│  │  └─────────────┘ └─────────────┘ └─────────────────────────┘ │
│  └────────────────────────────────────────────────────────────┘ │
│                              │                                   │
│                              │ IPC                               │
│                              ▼                                   │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │              ELECTRON UI SHELL (optional)                   │ │
│  │  ┌─────────────────────┐  ┌─────────────────────────────┐  │ │
│  │  │ Session Consent UI  │  │ Settings/Configuration      │  │ │
│  │  │ (when user present) │  │                             │  │ │
│  │  └─────────────────────┘  └─────────────────────────────┘  │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │          SYSTEM SERVICE (Elevated Component)               │ │
│  │  ┌─────────────────────┐  ┌─────────────────────────────┐  │ │
│  │  │ UAC Handler         │  │ Secure Desktop Access       │  │ │
│  │  │ (Windows only)      │  │ (Login screen, etc.)        │  │ │
│  │  └─────────────────────┘  └─────────────────────────────┘  │ │
│  └────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

---

## 2.2 Rust Core Implementation

### Crate Dependencies

```toml
[package]
name = "alga-remote-agent"
version = "0.1.0"
edition = "2021"

[dependencies]
# WebRTC
webrtc = "0.11"                    # Pure Rust WebRTC implementation

# Async runtime
tokio = { version = "1", features = ["full"] }

# Screen capture
scrap = "0.5"                      # Cross-platform screen capture

# Input injection (Windows)
windows = { version = "0.52", features = [
  "Win32_Foundation",
  "Win32_UI_Input_KeyboardAndMouse",
  "Win32_UI_WindowsAndMessaging",
  "Win32_System_Console",
]}

# Input injection (macOS)
core-graphics = "0.23"
core-foundation = "0.9"

# Terminal
portable-pty = "0.8"               # Cross-platform PTY
conpty = "0.5"                     # Windows ConPTY specifically

# Encoding
x264 = "0.5"                       # H.264 encoding (consider VP8/VP9 for licensing)
vpx = "0.5"                        # VP8/VP9 encoding (royalty-free)

# Networking
tokio-tungstenite = "0.21"         # WebSocket for signaling
rustls = "0.22"                    # TLS

# Serialization
serde = { version = "1", features = ["derive"] }
serde_json = "1"

# System info
sysinfo = "0.30"
machine-uid = "0.3"                # Hardware-based machine ID

# IPC
interprocess = "2"                 # Cross-platform IPC

# Logging
tracing = "0.1"
tracing-subscriber = "0.3"

[target.'cfg(windows)'.dependencies]
windows-service = "0.6"            # Windows service support

[target.'cfg(target_os = "macos")'.dependencies]
cocoa = "0.25"
objc = "0.2"
```

### Screen Capture Module

```rust
use scrap::{Capturer, Display};
use std::time::Duration;
use tokio::sync::mpsc;

pub struct ScreenCapturer {
    capturer: Capturer,
    width: usize,
    height: usize,
    frame_tx: mpsc::Sender<Frame>,
}

impl ScreenCapturer {
    pub fn new(display_index: usize, frame_tx: mpsc::Sender<Frame>) -> Result<Self, CaptureError> {
        let displays = Display::all()?;
        let display = displays.into_iter().nth(display_index)
            .ok_or(CaptureError::DisplayNotFound)?;

        let capturer = Capturer::new(display)?;
        let width = capturer.width();
        let height = capturer.height();

        Ok(Self { capturer, width, height, frame_tx })
    }

    pub async fn capture_loop(&mut self, target_fps: u32) -> Result<(), CaptureError> {
        let frame_duration = Duration::from_secs(1) / target_fps;

        loop {
            let start = std::time::Instant::now();

            match self.capturer.frame() {
                Ok(buffer) => {
                    let frame = Frame {
                        data: buffer.to_vec(),
                        width: self.width,
                        height: self.height,
                        format: PixelFormat::Bgra8,
                        timestamp: std::time::SystemTime::now(),
                    };

                    if self.frame_tx.send(frame).await.is_err() {
                        break; // Receiver dropped
                    }
                }
                Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                    // Frame not ready yet
                }
                Err(e) => return Err(e.into()),
            }

            let elapsed = start.elapsed();
            if elapsed < frame_duration {
                tokio::time::sleep(frame_duration - elapsed).await;
            }
        }

        Ok(())
    }
}
```

### Input Injection Module

#### Windows Implementation

```rust
#[cfg(windows)]
mod windows_input {
    use windows::Win32::UI::Input::KeyboardAndMouse::*;
    use windows::Win32::UI::WindowsAndMessaging::*;

    pub struct InputInjector;

    impl InputInjector {
        pub fn inject_mouse_move(&self, x: i32, y: i32) -> Result<(), InputError> {
            unsafe {
                SetCursorPos(x, y)?;
            }
            Ok(())
        }

        pub fn inject_mouse_button(&self, button: MouseButton, pressed: bool) -> Result<(), InputError> {
            let flags = match (button, pressed) {
                (MouseButton::Left, true) => MOUSEEVENTF_LEFTDOWN,
                (MouseButton::Left, false) => MOUSEEVENTF_LEFTUP,
                (MouseButton::Right, true) => MOUSEEVENTF_RIGHTDOWN,
                (MouseButton::Right, false) => MOUSEEVENTF_RIGHTUP,
                (MouseButton::Middle, true) => MOUSEEVENTF_MIDDLEDOWN,
                (MouseButton::Middle, false) => MOUSEEVENTF_MIDDLEUP,
            };

            let input = INPUT {
                r#type: INPUT_MOUSE,
                Anonymous: INPUT_0 {
                    mi: MOUSEINPUT {
                        dwFlags: flags,
                        ..Default::default()
                    },
                },
            };

            unsafe {
                SendInput(&[input], std::mem::size_of::<INPUT>() as i32);
            }

            Ok(())
        }

        pub fn inject_key(&self, vk: u16, pressed: bool) -> Result<(), InputError> {
            let flags = if pressed { KEYBD_EVENT_FLAGS(0) } else { KEYEVENTF_KEYUP };

            let input = INPUT {
                r#type: INPUT_KEYBOARD,
                Anonymous: INPUT_0 {
                    ki: KEYBDINPUT {
                        wVk: VIRTUAL_KEY(vk),
                        dwFlags: flags,
                        ..Default::default()
                    },
                },
            };

            unsafe {
                SendInput(&[input], std::mem::size_of::<INPUT>() as i32);
            }

            Ok(())
        }
    }
}
```

#### macOS Implementation

```rust
#[cfg(target_os = "macos")]
mod macos_input {
    use core_graphics::event::{CGEvent, CGEventTapLocation, CGEventType, CGMouseButton};
    use core_graphics::event_source::{CGEventSource, CGEventSourceStateID};
    use core_graphics::geometry::CGPoint;

    pub struct InputInjector {
        event_source: CGEventSource,
    }

    impl InputInjector {
        pub fn new() -> Result<Self, InputError> {
            let event_source = CGEventSource::new(CGEventSourceStateID::HIDSystemState)?;
            Ok(Self { event_source })
        }

        pub fn inject_mouse_move(&self, x: f64, y: f64) -> Result<(), InputError> {
            let point = CGPoint::new(x, y);
            let event = CGEvent::new_mouse_event(
                self.event_source.clone(),
                CGEventType::MouseMoved,
                point,
                CGMouseButton::Left, // Ignored for move events
            )?;

            event.post(CGEventTapLocation::HID);
            Ok(())
        }

        pub fn inject_mouse_button(&self, button: MouseButton, pressed: bool) -> Result<(), InputError> {
            let (cg_button, event_type) = match (button, pressed) {
                (MouseButton::Left, true) => (CGMouseButton::Left, CGEventType::LeftMouseDown),
                (MouseButton::Left, false) => (CGMouseButton::Left, CGEventType::LeftMouseUp),
                (MouseButton::Right, true) => (CGMouseButton::Right, CGEventType::RightMouseDown),
                (MouseButton::Right, false) => (CGMouseButton::Right, CGEventType::RightMouseUp),
                // ... other buttons
            };

            let point = CGEvent::new(self.event_source.clone())?.location();
            let event = CGEvent::new_mouse_event(
                self.event_source.clone(),
                event_type,
                point,
                cg_button,
            )?;

            event.post(CGEventTapLocation::HID);
            Ok(())
        }

        pub fn inject_key(&self, keycode: u16, pressed: bool) -> Result<(), InputError> {
            let event = CGEvent::new_keyboard_event(
                self.event_source.clone(),
                keycode,
                pressed,
            )?;

            event.post(CGEventTapLocation::HID);
            Ok(())
        }
    }
}
```

### PTY Terminal Module

```rust
use portable_pty::{CommandBuilder, PtySize, PtySystem, native_pty_system};
use tokio::sync::mpsc;

pub struct PtyTerminal {
    master: Box<dyn portable_pty::MasterPty + Send>,
    child: Box<dyn portable_pty::Child + Send>,
    reader: Box<dyn std::io::Read + Send>,
    writer: Box<dyn std::io::Write + Send>,
}

impl PtyTerminal {
    pub fn new(cols: u16, rows: u16) -> Result<Self, PtyError> {
        let pty_system = native_pty_system();

        let pair = pty_system.openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })?;

        // Platform-specific shell
        #[cfg(windows)]
        let cmd = {
            let mut cmd = CommandBuilder::new("cmd.exe");
            cmd
        };

        #[cfg(unix)]
        let cmd = {
            let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".to_string());
            let mut cmd = CommandBuilder::new(&shell);
            cmd.arg("-l"); // Login shell
            cmd
        };

        let child = pair.slave.spawn_command(cmd)?;
        let reader = pair.master.try_clone_reader()?;
        let writer = pair.master.take_writer()?;

        Ok(Self {
            master: pair.master,
            child,
            reader,
            writer,
        })
    }

    pub fn resize(&self, cols: u16, rows: u16) -> Result<(), PtyError> {
        self.master.resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })?;
        Ok(())
    }

    pub fn write(&mut self, data: &[u8]) -> Result<(), PtyError> {
        self.writer.write_all(data)?;
        Ok(())
    }

    pub async fn read_loop(&mut self, tx: mpsc::Sender<Vec<u8>>) -> Result<(), PtyError> {
        let mut buffer = [0u8; 4096];
        loop {
            match self.reader.read(&mut buffer) {
                Ok(0) => break, // EOF
                Ok(n) => {
                    if tx.send(buffer[..n].to_vec()).await.is_err() {
                        break;
                    }
                }
                Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                    tokio::time::sleep(Duration::from_millis(10)).await;
                }
                Err(e) => return Err(e.into()),
            }
        }
        Ok(())
    }
}
```

### WebRTC Integration

```rust
use webrtc::api::APIBuilder;
use webrtc::api::media_engine::MediaEngine;
use webrtc::data_channel::RTCDataChannel;
use webrtc::peer_connection::RTCPeerConnection;
use webrtc::peer_connection::configuration::RTCConfiguration;
use webrtc::track::track_local::TrackLocal;
use webrtc::track::track_local::track_local_static_rtp::TrackLocalStaticRTP;

pub struct WebRTCSession {
    peer_connection: RTCPeerConnection,
    video_track: Arc<TrackLocalStaticRTP>,
    data_channels: HashMap<String, Arc<RTCDataChannel>>,
}

impl WebRTCSession {
    pub async fn new(config: RTCConfiguration) -> Result<Self, WebRTCError> {
        let mut media_engine = MediaEngine::default();
        media_engine.register_default_codecs()?;

        let api = APIBuilder::new()
            .with_media_engine(media_engine)
            .build();

        let peer_connection = api.new_peer_connection(config).await?;

        // Create video track for screen sharing
        let video_track = Arc::new(TrackLocalStaticRTP::new(
            RTCRtpCodecCapability {
                mime_type: "video/VP8".to_string(),
                ..Default::default()
            },
            "screen".to_string(),
            "screen-stream".to_string(),
        ));

        peer_connection.add_track(Arc::clone(&video_track) as Arc<dyn TrackLocal + Send + Sync>).await?;

        Ok(Self {
            peer_connection,
            video_track,
            data_channels: HashMap::new(),
        })
    }

    pub async fn create_data_channel(&mut self, label: &str) -> Result<Arc<RTCDataChannel>, WebRTCError> {
        let dc = self.peer_connection.create_data_channel(label, None).await?;
        let dc = Arc::new(dc);
        self.data_channels.insert(label.to_string(), Arc::clone(&dc));
        Ok(dc)
    }

    pub async fn send_video_frame(&self, encoded_frame: &[u8], timestamp: u32) -> Result<(), WebRTCError> {
        // RTP packetization would go here
        // This is simplified; real implementation needs proper RTP handling
        self.video_track.write_rtp(&webrtc::rtp::packet::Packet {
            header: webrtc::rtp::header::Header {
                timestamp,
                ..Default::default()
            },
            payload: bytes::Bytes::copy_from_slice(encoded_frame),
        }).await?;

        Ok(())
    }
}
```

---

## 2.3 Windows System Service

### Purpose
Runs with SYSTEM privileges to handle:
- UAC prompts
- Secure Desktop (Ctrl+Alt+Del, login screen)
- Pre-login remote access
- Unattended access when no user logged in

### Implementation

```rust
use windows_service::{
    define_windows_service,
    service::{
        ServiceControl, ServiceControlAccept, ServiceExitCode, ServiceState, ServiceStatus,
        ServiceType,
    },
    service_control_handler::{self, ServiceControlHandlerResult},
    service_dispatcher,
};

const SERVICE_NAME: &str = "AlgaRemoteAgent";
const SERVICE_DISPLAY_NAME: &str = "Alga Remote Support Agent";

define_windows_service!(ffi_service_main, service_main);

fn service_main(arguments: Vec<OsString>) {
    if let Err(e) = run_service(arguments) {
        // Log error
    }
}

fn run_service(_arguments: Vec<OsString>) -> Result<(), windows_service::Error> {
    let event_handler = move |control_event| -> ServiceControlHandlerResult {
        match control_event {
            ServiceControl::Stop => {
                // Graceful shutdown
                ServiceControlHandlerResult::NoError
            }
            ServiceControl::Interrogate => ServiceControlHandlerResult::NoError,
            _ => ServiceControlHandlerResult::NotImplemented,
        }
    };

    let status_handle = service_control_handler::register(SERVICE_NAME, event_handler)?;

    status_handle.set_service_status(ServiceStatus {
        service_type: ServiceType::OWN_PROCESS,
        current_state: ServiceState::Running,
        controls_accepted: ServiceControlAccept::STOP,
        exit_code: ServiceExitCode::Win32(0),
        checkpoint: 0,
        wait_hint: Duration::default(),
        process_id: None,
    })?;

    // Run the main service logic
    let runtime = tokio::runtime::Runtime::new().unwrap();
    runtime.block_on(async {
        run_elevated_agent().await
    });

    status_handle.set_service_status(ServiceStatus {
        service_type: ServiceType::OWN_PROCESS,
        current_state: ServiceState::Stopped,
        controls_accepted: ServiceControlAccept::empty(),
        exit_code: ServiceExitCode::Win32(0),
        checkpoint: 0,
        wait_hint: Duration::default(),
        process_id: None,
    })?;

    Ok(())
}

async fn run_elevated_agent() {
    // IPC server listening for requests from user-mode agent
    // Handles:
    // - Switching to secure desktop
    // - Input injection during UAC
    // - Session 0 isolation bridging
}
```

### UAC Handling Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     USER SESSION                                 │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │  User-Mode Agent                                            │ │
│  │  - Normal screen capture                                    │ │
│  │  - Normal input injection                                   │ │
│  │  - Detects UAC prompt appearance                            │ │
│  └──────────────────────────────┬──────────────────────────────┘ │
│                                 │                                │
│                                 │ IPC (Named Pipe)               │
│                                 ▼                                │
└─────────────────────────────────┬────────────────────────────────┘
                                  │
                                  │
┌─────────────────────────────────┴────────────────────────────────┐
│                     SESSION 0 (SYSTEM)                           │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │  System Service                                             │ │
│  │  - Receives "UAC detected" notification                     │ │
│  │  - Captures Secure Desktop                                  │ │
│  │  - Injects input on Secure Desktop                          │ │
│  │  - Returns to normal mode when UAC dismissed                │ │
│  └─────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

---

## 2.4 macOS Privileged Helper

### Purpose
Similar to Windows System Service, handles operations requiring elevated privileges.

### Implementation Approach

macOS uses `launchd` for privileged helpers with XPC for communication.

```rust
// launchd plist: /Library/LaunchDaemons/com.algapsa.remote-agent.plist
/*
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.algapsa.remote-agent</string>
    <key>ProgramArguments</key>
    <array>
        <string>/Library/PrivilegedHelperTools/com.algapsa.remote-agent</string>
    </array>
    <key>MachServices</key>
    <dict>
        <key>com.algapsa.remote-agent.xpc</key>
        <true/>
    </dict>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
</dict>
</plist>
*/
```

### Accessibility Permissions

macOS requires explicit user consent for:
- Screen Recording (`kTCCServiceScreenCapture`)
- Accessibility (`kTCCServiceAccessibility`) - for input injection

```rust
use core_graphics::access::ScreenCaptureAccess;

fn check_permissions() -> PermissionStatus {
    // Check screen recording permission
    let screen_capture = ScreenCaptureAccess::preflight();

    // Check accessibility permission
    let accessibility = unsafe {
        let options = core_foundation::dictionary::CFDictionary::from_CFType_pairs(&[]);
        accessibility::AXIsProcessTrustedWithOptions(options.as_concrete_TypeRef())
    };

    PermissionStatus {
        screen_capture,
        accessibility,
    }
}

fn request_permissions() {
    // Open System Preferences to the appropriate pane
    let url = "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture";
    std::process::Command::new("open")
        .arg(url)
        .spawn()
        .ok();
}
```

---

## 2.5 Electron UI Shell

### Purpose
Provides a native-feeling UI for:
- User consent prompts
- Configuration/settings
- Connection status indicator
- System tray integration

### Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    ELECTRON APP                                  │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │  Main Process (Node.js)                                     │ │
│  │  - IPC with Rust agent via:                                 │ │
│  │    - Named pipes (Windows)                                  │ │
│  │    - Unix domain sockets (macOS)                            │ │
│  │  - System tray management                                   │ │
│  │  - Native notifications                                     │ │
│  └──────────────────────────────┬──────────────────────────────┘ │
│                                 │                                │
│                                 │ IPC                            │
│                                 ▼                                │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │  Renderer Process                                           │ │
│  │  - React-based UI                                           │ │
│  │  - Session consent dialog                                   │ │
│  │  - Settings panel                                           │ │
│  │  - Connection history                                       │ │
│  └─────────────────────────────────────────────────────────────┘ │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### User Consent UI

```typescript
// Consent dialog shown when engineer requests connection
interface ConsentDialogProps {
  engineerName: string;
  engineerCompany: string;
  requestedCapabilities: {
    viewScreen: boolean;
    controlInput: boolean;
    accessTerminal: boolean;
    transferFiles: boolean;
  };
  onAccept: () => void;
  onDeny: () => void;
  timeout: number; // Auto-deny after timeout
}

const ConsentDialog: React.FC<ConsentDialogProps> = ({
  engineerName,
  engineerCompany,
  requestedCapabilities,
  onAccept,
  onDeny,
  timeout,
}) => {
  const [remaining, setRemaining] = useState(timeout);

  useEffect(() => {
    const timer = setInterval(() => {
      setRemaining(r => {
        if (r <= 1) {
          onDeny();
          return 0;
        }
        return r - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="consent-dialog">
      <h2>Remote Support Request</h2>
      <p>
        <strong>{engineerName}</strong> from <strong>{engineerCompany}</strong>
        is requesting to connect to your computer.
      </p>

      <h3>Requested Permissions:</h3>
      <ul>
        {requestedCapabilities.viewScreen && <li>View your screen</li>}
        {requestedCapabilities.controlInput && <li>Control mouse and keyboard</li>}
        {requestedCapabilities.accessTerminal && <li>Access command line</li>}
        {requestedCapabilities.transferFiles && <li>Transfer files</li>}
      </ul>

      <p className="timeout-warning">
        This request will automatically be denied in {remaining} seconds.
      </p>

      <div className="actions">
        <button onClick={onDeny} className="deny">Deny</button>
        <button onClick={onAccept} className="accept">Accept</button>
      </div>
    </div>
  );
};
```

---

# Part 3: Agent Installer & Enterprise Deployment

## 3.1 Installer Requirements

### Goals
1. **Simple**: One-click installation for end users
2. **Silent**: Support for `/S` or `-silent` flags
3. **Configurable**: Accept enrollment code/server URL at install time
4. **Enterprise-Ready**: MSI for Windows, PKG for macOS
5. **Signed**: Code-signed binaries for trust

### Windows Installer (MSI)

#### Build Tool: WiX Toolset 4

```xml
<!-- Product.wxs -->
<Wix xmlns="http://wixtoolset.org/schemas/v4/wxs">
  <Package Name="Alga Remote Agent"
           Manufacturer="Alga PSA"
           Version="1.0.0"
           UpgradeCode="GUID-HERE">

    <MajorUpgrade DowngradeErrorMessage="A newer version is installed." />

    <!-- Features -->
    <Feature Id="MainFeature" Level="1">
      <ComponentGroupRef Id="AgentComponents" />
      <ComponentGroupRef Id="ServiceComponents" />
      <ComponentGroupRef Id="ElectronComponents" />
    </Feature>

    <!-- Custom Actions -->
    <CustomAction Id="SetEnrollmentCode"
                  Property="ENROLLMENT_CODE"
                  Value="[ENROLLMENT_CODE]" />

    <CustomAction Id="SetServerUrl"
                  Property="SERVER_URL"
                  Value="[SERVER_URL]" />

    <CustomAction Id="InstallService"
                  Directory="INSTALLFOLDER"
                  ExeCommand="alga-remote-agent.exe --install-service"
                  Execute="deferred"
                  Impersonate="no" />

    <CustomAction Id="StartService"
                  Directory="INSTALLFOLDER"
                  ExeCommand="sc start AlgaRemoteAgent"
                  Execute="deferred"
                  Impersonate="no" />

    <InstallExecuteSequence>
      <Custom Action="InstallService" After="InstallFiles">NOT Installed</Custom>
      <Custom Action="StartService" After="InstallService">NOT Installed</Custom>
    </InstallExecuteSequence>

  </Package>
</Wix>
```

#### Enterprise Deployment via Group Policy

```batch
:: Deploy via GPO or SCCM
msiexec /i AlgaRemoteAgent.msi /qn ^
  ENROLLMENT_CODE=ABC123 ^
  SERVER_URL=https://remote.algapsa.com ^
  /l*v install.log
```

### macOS Installer (PKG)

#### Build Tool: pkgbuild + productbuild

```bash
#!/bin/bash
# build-macos-pkg.sh

# Build the component package
pkgbuild \
  --root ./dist/macos \
  --identifier com.algapsa.remote-agent \
  --version 1.0.0 \
  --install-location /Applications/Alga\ Remote\ Agent \
  --scripts ./scripts \
  component.pkg

# Create distribution XML
cat > distribution.xml << 'EOF'
<?xml version="1.0" encoding="utf-8"?>
<installer-script minSpecVersion="1.000000">
    <title>Alga Remote Agent</title>
    <options customize="never" require-scripts="false" hostArchitectures="x86_64,arm64"/>
    <domains enable_anywhere="false" enable_currentUserHome="false" enable_localSystem="true"/>
    <choices-outline>
        <line choice="default"/>
    </choices-outline>
    <choice id="default" title="Alga Remote Agent">
        <pkg-ref id="com.algapsa.remote-agent"/>
    </choice>
    <pkg-ref id="com.algapsa.remote-agent" version="1.0.0" onConclusion="none">component.pkg</pkg-ref>
</installer-script>
EOF

# Build the final installer
productbuild \
  --distribution distribution.xml \
  --package-path . \
  --sign "Developer ID Installer: Alga PSA Inc" \
  AlgaRemoteAgent-1.0.0.pkg
```

#### Enterprise Deployment via MDM

```xml
<!-- Jamf Pro / Kandji configuration profile -->
<plist version="1.0">
<dict>
    <key>PayloadContent</key>
    <array>
        <dict>
            <key>PayloadType</key>
            <string>com.algapsa.remote-agent</string>
            <key>PayloadIdentifier</key>
            <string>com.algapsa.remote-agent.config</string>
            <key>ServerUrl</key>
            <string>https://remote.algapsa.com</string>
            <key>EnrollmentCode</key>
            <string>ABC123</string>
        </dict>
    </array>
</dict>
</plist>
```

---

## 3.2 Enrollment Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                    ENROLLMENT FLOW                               │
│                                                                  │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────────────┐  │
│  │  MSP Admin  │    │  Alga PSA   │    │  Target Machine     │  │
│  │  Portal     │    │  Server     │    │                     │  │
│  └──────┬──────┘    └──────┬──────┘    └──────────┬──────────┘  │
│         │                  │                      │              │
│         │ 1. Generate      │                      │              │
│         │    enrollment    │                      │              │
│         │    code          │                      │              │
│         │─────────────────►│                      │              │
│         │                  │                      │              │
│         │◄─────────────────│                      │              │
│         │ 2. Code: ABC123  │                      │              │
│         │    (expires 24h) │                      │              │
│         │                  │                      │              │
│         │ 3. Share code    │                      │              │
│         │  with end user   │                      │              │
│         │  or deploy via   │                      │              │
│         │  MDM/GPO         │                      │              │
│         │──────────────────┼─────────────────────►│              │
│         │                  │                      │              │
│         │                  │ 4. Agent installed   │              │
│         │                  │    with code         │              │
│         │                  │◄─────────────────────│              │
│         │                  │                      │              │
│         │                  │ 5. Validate code,    │              │
│         │                  │    return config +   │              │
│         │                  │    server cert       │              │
│         │                  │─────────────────────►│              │
│         │                  │                      │              │
│         │                  │ 6. Agent generates   │              │
│         │                  │    keypair, sends    │              │
│         │                  │    public key        │              │
│         │                  │◄─────────────────────│              │
│         │                  │                      │              │
│         │                  │ 7. Store public key, │              │
│         │                  │    return agent ID   │              │
│         │                  │─────────────────────►│              │
│         │                  │                      │              │
│         │ 8. Agent appears │                      │              │
│         │    in portal     │                      │              │
│         │◄─────────────────│                      │              │
│         │                  │                      │              │
└─────────┴──────────────────┴──────────────────────┴──────────────┘
```

### Enrollment Code Security

```typescript
interface EnrollmentCode {
  code: string;          // Short, user-friendly (e.g., "ABC-123-XYZ")
  tenantId: string;
  companyId?: string;    // Optional - restrict to specific company
  expiresAt: Date;       // 24 hours default
  usageLimit: number;    // How many agents can use this code
  usageCount: number;    // Current usage
  createdBy: string;     // User who generated
  permissions: RemoteAccessPermission;  // Permissions for enrolled agents
}

// Code generation
function generateEnrollmentCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // No O/0/I/1 confusion
  const segments = [];
  for (let i = 0; i < 3; i++) {
    let segment = '';
    for (let j = 0; j < 3; j++) {
      segment += chars[crypto.randomInt(chars.length)];
    }
    segments.push(segment);
  }
  return segments.join('-'); // e.g., "ABC-123-XYZ"
}
```

---

# Part 4: Engineer Browser Client

## 4.1 Overview

The engineer accesses remote machines through a browser-based interface integrated into the Alga PSA web application. No installation required.

### Technology Stack
- **WebRTC**: Native browser WebRTC APIs
- **Video Rendering**: HTML5 `<video>` element
- **Input Capture**: JavaScript keyboard/mouse event handlers
- **Terminal**: xterm.js
- **File Transfer**: Data channel with chunked transfer protocol

---

## 4.2 Desktop Viewer Component

```typescript
// components/remote/DesktopViewer.tsx
import React, { useRef, useEffect, useState, useCallback } from 'react';

interface DesktopViewerProps {
  sessionId: string;
  onSessionEnd: () => void;
}

export const DesktopViewer: React.FC<DesktopViewerProps> = ({ sessionId, onSessionEnd }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [peerConnection, setPeerConnection] = useState<RTCPeerConnection | null>(null);
  const [inputChannel, setInputChannel] = useState<RTCDataChannel | null>(null);
  const [connected, setConnected] = useState(false);
  const [quality, setQuality] = useState<'auto' | 'high' | 'medium' | 'low'>('auto');

  // Initialize WebRTC connection
  useEffect(() => {
    const initConnection = async () => {
      const pc = new RTCPeerConnection({
        iceServers: [
          { urls: 'stun:stun.algapsa.com:3478' },
          {
            urls: 'turn:turn.algapsa.com:3478',
            username: 'session-token',
            credential: 'session-credential',
          },
        ],
      });

      // Handle incoming video track
      pc.ontrack = (event) => {
        if (videoRef.current && event.streams[0]) {
          videoRef.current.srcObject = event.streams[0];
        }
      };

      // Create data channel for input
      const dc = pc.createDataChannel('input', { ordered: true });
      dc.onopen = () => setConnected(true);
      dc.onclose = () => setConnected(false);
      setInputChannel(dc);

      // Signaling logic here...
      // Exchange SDP offer/answer with signaling server

      setPeerConnection(pc);
    };

    initConnection();

    return () => {
      peerConnection?.close();
    };
  }, [sessionId]);

  // Mouse event handlers
  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!inputChannel || inputChannel.readyState !== 'open') return;

    const rect = containerRef.current!.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;

    inputChannel.send(JSON.stringify({
      type: 'mouse-move',
      x,
      y,
    }));
  }, [inputChannel]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (!inputChannel || inputChannel.readyState !== 'open') return;

    inputChannel.send(JSON.stringify({
      type: 'mouse-button',
      button: e.button,
      pressed: true,
    }));
  }, [inputChannel]);

  const handleMouseUp = useCallback((e: React.MouseEvent) => {
    if (!inputChannel || inputChannel.readyState !== 'open') return;

    inputChannel.send(JSON.stringify({
      type: 'mouse-button',
      button: e.button,
      pressed: false,
    }));
  }, [inputChannel]);

  // Keyboard event handlers
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (!inputChannel || inputChannel.readyState !== 'open') return;

    e.preventDefault();

    inputChannel.send(JSON.stringify({
      type: 'key',
      key: e.key,
      code: e.code,
      pressed: true,
      modifiers: {
        ctrl: e.ctrlKey,
        alt: e.altKey,
        shift: e.shiftKey,
        meta: e.metaKey,
      },
    }));
  }, [inputChannel]);

  const handleKeyUp = useCallback((e: React.KeyboardEvent) => {
    if (!inputChannel || inputChannel.readyState !== 'open') return;

    e.preventDefault();

    inputChannel.send(JSON.stringify({
      type: 'key',
      key: e.key,
      code: e.code,
      pressed: false,
      modifiers: {
        ctrl: e.ctrlKey,
        alt: e.altKey,
        shift: e.shiftKey,
        meta: e.metaKey,
      },
    }));
  }, [inputChannel]);

  // Fullscreen toggle
  const toggleFullscreen = () => {
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      containerRef.current?.requestFullscreen();
    }
  };

  return (
    <div className="desktop-viewer">
      <div className="toolbar">
        <div className="connection-status">
          {connected ? (
            <span className="connected">● Connected</span>
          ) : (
            <span className="connecting">○ Connecting...</span>
          )}
        </div>

        <div className="controls">
          <select
            value={quality}
            onChange={(e) => setQuality(e.target.value as any)}
          >
            <option value="auto">Auto Quality</option>
            <option value="high">High (1080p)</option>
            <option value="medium">Medium (720p)</option>
            <option value="low">Low (480p)</option>
          </select>

          <button onClick={toggleFullscreen}>
            ⛶ Fullscreen
          </button>

          <button onClick={onSessionEnd} className="end-session">
            End Session
          </button>
        </div>
      </div>

      <div
        ref={containerRef}
        className="video-container"
        tabIndex={0}
        onMouseMove={handleMouseMove}
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
        onKeyDown={handleKeyDown}
        onKeyUp={handleKeyUp}
        onContextMenu={(e) => e.preventDefault()}
      >
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
        />
      </div>
    </div>
  );
};
```

### Styling

```css
/* styles/desktop-viewer.css */
.desktop-viewer {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: #1a1a1a;
}

.toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 16px;
  background: #2a2a2a;
  border-bottom: 1px solid #3a3a3a;
}

.connection-status .connected {
  color: #4caf50;
}

.connection-status .connecting {
  color: #ff9800;
}

.controls {
  display: flex;
  gap: 8px;
}

.controls button {
  padding: 6px 12px;
  border: 1px solid #4a4a4a;
  background: #3a3a3a;
  color: white;
  border-radius: 4px;
  cursor: pointer;
}

.controls button:hover {
  background: #4a4a4a;
}

.controls .end-session {
  background: #d32f2f;
  border-color: #d32f2f;
}

.video-container {
  flex: 1;
  position: relative;
  overflow: hidden;
  cursor: none; /* Hide cursor, render remote cursor */
}

.video-container:focus {
  outline: 2px solid #2196f3;
}

.video-container video {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  max-width: 100%;
  max-height: 100%;
}
```

---

## 4.3 Terminal Component (xterm.js)

```typescript
// components/remote/RemoteTerminal.tsx
import React, { useRef, useEffect } from 'react';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import { WebLinksAddon } from 'xterm-addon-web-links';
import 'xterm/css/xterm.css';

interface RemoteTerminalProps {
  dataChannel: RTCDataChannel;
  onClose: () => void;
}

export const RemoteTerminal: React.FC<RemoteTerminalProps> = ({ dataChannel, onClose }) => {
  const terminalRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);

  useEffect(() => {
    if (!terminalRef.current) return;

    // Create terminal instance
    const term = new Terminal({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: 'JetBrains Mono, Menlo, Monaco, monospace',
      theme: {
        background: '#1e1e1e',
        foreground: '#d4d4d4',
        cursor: '#ffffff',
        selection: 'rgba(255, 255, 255, 0.3)',
      },
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(new WebLinksAddon());

    term.open(terminalRef.current);
    fitAddon.fit();

    termRef.current = term;
    fitAddonRef.current = fitAddon;

    // Handle incoming data from remote PTY
    dataChannel.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.type === 'pty-output') {
        term.write(new Uint8Array(data.data));
      }
    };

    // Send user input to remote PTY
    term.onData((data) => {
      dataChannel.send(JSON.stringify({
        type: 'pty-input',
        data: Array.from(new TextEncoder().encode(data)),
      }));
    });

    // Handle terminal resize
    term.onResize(({ cols, rows }) => {
      dataChannel.send(JSON.stringify({
        type: 'pty-resize',
        cols,
        rows,
      }));
    });

    // Handle window resize
    const handleResize = () => {
      fitAddon.fit();
    };
    window.addEventListener('resize', handleResize);

    // Send initial size
    setTimeout(() => {
      dataChannel.send(JSON.stringify({
        type: 'pty-resize',
        cols: term.cols,
        rows: term.rows,
      }));
    }, 100);

    return () => {
      window.removeEventListener('resize', handleResize);
      term.dispose();
    };
  }, [dataChannel]);

  return (
    <div className="remote-terminal">
      <div className="terminal-header">
        <span>Terminal</span>
        <button onClick={onClose}>×</button>
      </div>
      <div ref={terminalRef} className="terminal-container" />
    </div>
  );
};
```

---

## 4.4 File Transfer Component

```typescript
// components/remote/FileTransfer.tsx
import React, { useState, useCallback } from 'react';

interface FileTransferProps {
  dataChannel: RTCDataChannel;
}

interface TransferProgress {
  filename: string;
  direction: 'upload' | 'download';
  progress: number;
  size: number;
  speed: number;
}

export const FileTransfer: React.FC<FileTransferProps> = ({ dataChannel }) => {
  const [transfers, setTransfers] = useState<TransferProgress[]>([]);
  const [dragOver, setDragOver] = useState(false);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);

    const files = Array.from(e.dataTransfer.files);

    for (const file of files) {
      // Create transfer entry
      const transferId = crypto.randomUUID();
      setTransfers(prev => [...prev, {
        filename: file.name,
        direction: 'upload',
        progress: 0,
        size: file.size,
        speed: 0,
      }]);

      // Send file metadata
      dataChannel.send(JSON.stringify({
        type: 'file-start',
        transferId,
        filename: file.name,
        size: file.size,
      }));

      // Chunk and send file
      const CHUNK_SIZE = 16 * 1024; // 16KB chunks
      const reader = file.stream().getReader();
      let offset = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        // Send chunk as binary
        dataChannel.send(JSON.stringify({
          type: 'file-chunk',
          transferId,
          offset,
          data: Array.from(value),
        }));

        offset += value.length;

        // Update progress
        setTransfers(prev => prev.map(t =>
          t.filename === file.name
            ? { ...t, progress: offset / file.size }
            : t
        ));
      }

      // Send completion
      dataChannel.send(JSON.stringify({
        type: 'file-end',
        transferId,
      }));
    }
  }, [dataChannel]);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  };

  const handleDragLeave = () => {
    setDragOver(false);
  };

  return (
    <div className="file-transfer">
      <div
        className={`drop-zone ${dragOver ? 'drag-over' : ''}`}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
      >
        <p>Drop files here to upload to remote machine</p>
      </div>

      <div className="transfer-list">
        {transfers.map((transfer, i) => (
          <div key={i} className="transfer-item">
            <span className="filename">{transfer.filename}</span>
            <span className="direction">
              {transfer.direction === 'upload' ? '↑' : '↓'}
            </span>
            <div className="progress-bar">
              <div
                className="progress-fill"
                style={{ width: `${transfer.progress * 100}%` }}
              />
            </div>
            <span className="percentage">
              {Math.round(transfer.progress * 100)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};
```

---

# Part 5: Security Architecture

## 5.1 Security Principles

1. **Zero Trust**: Every connection is authenticated and authorized
2. **Defense in Depth**: Multiple layers of security
3. **Least Privilege**: Agents and users only have necessary permissions
4. **Audit Everything**: Complete audit trail of all actions
5. **Encryption Everywhere**: End-to-end encryption for all data

---

## 5.2 Authentication & Authorization

### Agent Authentication

```
┌─────────────────────────────────────────────────────────────────┐
│                    AGENT AUTHENTICATION                          │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │  1. Enrollment Phase (One-time)                             │ │
│  │     - Agent generates Ed25519 keypair                       │ │
│  │     - Public key sent to server with enrollment code        │ │
│  │     - Server stores public key fingerprint                  │ │
│  └─────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │  2. Connection Phase (Every connection)                     │ │
│  │     - Agent connects via WSS                                │ │
│  │     - Server sends random challenge                         │ │
│  │     - Agent signs challenge with private key                │ │
│  │     - Server verifies signature against stored public key   │ │
│  └─────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │  3. Session Phase                                           │ │
│  │     - Short-lived session tokens (15 min)                   │ │
│  │     - Automatic renewal while active                        │ │
│  │     - Immediate revocation on disconnect                    │ │
│  └─────────────────────────────────────────────────────────────┘ │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Engineer Authentication

```typescript
// Integration with existing Alga PSA auth
interface RemoteSessionRequest {
  // Standard Alga PSA JWT
  authorization: string;

  // Session details
  agentId: string;
  requestedCapabilities: string[];

  // Additional verification for high-security environments
  mfaToken?: string;
  clientCertificate?: string;
}

// Middleware for remote session authorization
async function authorizeRemoteSession(
  req: RemoteSessionRequest,
  context: Context
): Promise<AuthorizationResult> {
  // 1. Validate JWT
  const user = await validateJwt(req.authorization);

  // 2. Check user has remote access permission
  const permissions = await getRemotePermissions(user.id, req.agentId);
  if (!permissions.canConnect) {
    return { authorized: false, reason: 'User lacks remote access permission' };
  }

  // 3. Verify requested capabilities are allowed
  for (const cap of req.requestedCapabilities) {
    if (!permissions[cap]) {
      return { authorized: false, reason: `Capability '${cap}' not permitted` };
    }
  }

  // 4. Check MFA if required
  if (permissions.requiresMfa && !await verifyMfa(user.id, req.mfaToken)) {
    return { authorized: false, reason: 'MFA verification required' };
  }

  // 5. Check time-based restrictions
  if (permissions.allowedTimeWindows) {
    if (!isWithinAllowedWindow(permissions.allowedTimeWindows)) {
      return { authorized: false, reason: 'Outside allowed time window' };
    }
  }

  return { authorized: true, permissions };
}
```

---

## 5.3 Encryption

### Transport Layer
- All WebSocket connections use TLS 1.3
- Certificate pinning for agent-to-server connections
- Perfect forward secrecy via ECDHE key exchange

### WebRTC Encryption
- DTLS 1.2/1.3 for key exchange
- SRTP with AES-128-GCM for media
- Data channels encrypted with DTLS

### At-Rest Encryption
- Agent private keys encrypted with machine-specific key
- Configuration files encrypted with AES-256-GCM
- Key derivation: Argon2id with hardware-derived salt

```rust
// Agent key storage
use argon2::{Argon2, password_hash::SaltString};
use aes_gcm::{Aes256Gcm, KeyInit, aead::Aead};
use machine_uid::get;

fn derive_storage_key() -> [u8; 32] {
    let machine_id = get().expect("Failed to get machine ID");
    let salt = SaltString::generate(&mut OsRng);

    let argon2 = Argon2::default();
    let mut output = [0u8; 32];

    argon2.hash_password_into(
        machine_id.as_bytes(),
        salt.as_str().as_bytes(),
        &mut output,
    ).expect("Key derivation failed");

    output
}

fn encrypt_private_key(private_key: &[u8]) -> Vec<u8> {
    let key = derive_storage_key();
    let cipher = Aes256Gcm::new_from_slice(&key).unwrap();
    let nonce = Nonce::from_slice(b"unique nonce"); // Use random nonce in production

    cipher.encrypt(nonce, private_key).expect("Encryption failed")
}
```

---

## 5.4 Audit Logging

### Events to Log

```typescript
enum RemoteSessionEvent {
  // Session lifecycle
  SESSION_REQUESTED = 'session.requested',
  SESSION_APPROVED = 'session.approved',
  SESSION_DENIED = 'session.denied',
  SESSION_CONNECTED = 'session.connected',
  SESSION_DISCONNECTED = 'session.disconnected',

  // Capabilities
  SCREEN_VIEW_STARTED = 'screen.view.started',
  SCREEN_VIEW_STOPPED = 'screen.view.stopped',
  INPUT_CONTROL_STARTED = 'input.control.started',
  INPUT_CONTROL_STOPPED = 'input.control.stopped',
  TERMINAL_OPENED = 'terminal.opened',
  TERMINAL_CLOSED = 'terminal.closed',

  // Actions
  FILE_UPLOADED = 'file.uploaded',
  FILE_DOWNLOADED = 'file.downloaded',
  CLIPBOARD_ACCESSED = 'clipboard.accessed',
  ELEVATION_REQUESTED = 'elevation.requested',
  ELEVATION_GRANTED = 'elevation.granted',

  // Security events
  AUTH_FAILED = 'auth.failed',
  PERMISSION_DENIED = 'permission.denied',
  SUSPICIOUS_ACTIVITY = 'suspicious.activity',
}

interface AuditLogEntry {
  id: string;
  timestamp: Date;
  tenantId: string;
  sessionId: string;
  eventType: RemoteSessionEvent;
  actorType: 'engineer' | 'agent' | 'system';
  actorId: string;
  targetAgentId: string;
  metadata: Record<string, any>;
  ipAddress: string;
  userAgent?: string;
}
```

### Session Recording (Optional Feature)

```typescript
// For regulated industries requiring session playback
interface SessionRecording {
  sessionId: string;
  startedAt: Date;
  endedAt: Date;

  // Video recording (encrypted)
  videoUrl: string;
  videoEncryptionKey: string; // Encrypted with tenant's key

  // Terminal recording
  terminalLog: string; // asciicast format

  // Metadata
  engineerId: string;
  agentId: string;
  eventCount: number;
}
```

---

## 5.5 Security Hardening Checklist

### Agent Hardening
- [ ] Binary signing (Authenticode for Windows, codesign for macOS)
- [ ] Anti-tampering checks on critical files
- [ ] Secure update mechanism with signature verification
- [ ] Memory protection (ASLR, DEP enabled)
- [ ] Minimal system permissions
- [ ] Secure IPC between components
- [ ] Rate limiting on connection attempts
- [ ] Automatic lockout after failed auth attempts

### Server Hardening
- [ ] Input validation on all endpoints
- [ ] Rate limiting per tenant/user
- [ ] CORS configuration
- [ ] CSP headers
- [ ] SQL injection prevention (parameterized queries)
- [ ] XSS prevention
- [ ] CSRF protection
- [ ] Session fixation prevention
- [ ] Secure session management

### Network Hardening
- [ ] TLS 1.3 only
- [ ] Strong cipher suites
- [ ] Certificate pinning on agent
- [ ] TURN server authentication
- [ ] DDoS protection
- [ ] IP allowlisting option

---

# Part 6: Implementation Phases

## Phase 1: Foundation (Weeks 1-4)

### Goals
- Core WebRTC infrastructure
- Basic signaling server
- Minimal viable agent

### Deliverables
1. **Server**
   - WebSocket signaling server
   - Session management API
   - Database schema for agents/sessions

2. **Agent (Windows only first)**
   - Basic screen capture
   - WebRTC connection
   - Simple input injection

3. **Browser Client**
   - Basic video viewer
   - Mouse/keyboard input

### Milestones
- [ ] Agent can connect to server
- [ ] Engineer can see remote screen
- [ ] Basic mouse movement works

---

## Phase 2: Core Features (Weeks 5-8)

### Goals
- Full input support
- Terminal access
- macOS agent

### Deliverables
1. **Server**
   - TURN server deployment
   - Enrollment system
   - Basic permissions

2. **Agent**
   - Complete keyboard support (including special keys)
   - PTY terminal
   - macOS port

3. **Browser Client**
   - xterm.js terminal
   - Keyboard shortcuts handling
   - Quality selection

### Milestones
- [ ] Full keyboard/mouse control
- [ ] Terminal access works
- [ ] macOS agent functional

---

## Phase 3: Enterprise Features (Weeks 9-12)

### Goals
- Windows service for UAC
- Enterprise deployment
- Security hardening

### Deliverables
1. **Server**
   - Full permission model
   - Audit logging
   - Multi-tenant support

2. **Agent**
   - Windows system service
   - macOS privileged helper
   - MSI/PKG installers
   - Silent installation support

3. **Browser Client**
   - File transfer
   - Multi-monitor support
   - Session recording playback

### Milestones
- [ ] UAC prompts accessible
- [ ] Enterprise deployment works
- [ ] Security audit passed

---

## Phase 4: Polish & Launch (Weeks 13-16)

### Goals
- Production readiness
- Documentation
- Performance optimization

### Deliverables
1. **Server**
   - Horizontal scaling
   - Monitoring/alerting
   - Disaster recovery

2. **Agent**
   - Auto-update mechanism
   - Crash reporting
   - Performance tuning

3. **Browser Client**
   - UI polish
   - Accessibility
   - Mobile responsiveness

4. **Documentation**
   - Admin guide
   - User guide
   - API documentation
   - Security whitepaper

### Milestones
- [ ] Load testing passed (1000 concurrent sessions)
- [ ] Documentation complete
- [ ] Beta testing complete
- [ ] Production deployment

---

# Part 7: Technology Decisions & Alternatives

## 7.1 WebRTC Library: webrtc-rs

### Why webrtc-rs?
- Pure Rust implementation
- Cross-platform
- Active development
- No C/C++ dependencies (easier builds)

### Alternatives Considered
| Library | Pros | Cons |
|---------|------|------|
| libwebrtc | Google's reference, battle-tested | Massive, complex build, C++ |
| Pion (Go) | Mature, well-documented | Would require Go component |
| mediasoup | SFU capabilities | Server-focused, Node.js |

---

## 7.2 Video Codec: VP8/VP9 vs H.264

### Recommendation: VP8/VP9

| Factor | VP8/VP9 | H.264 |
|--------|---------|-------|
| Licensing | Royalty-free | May require licensing |
| Browser Support | Universal | Universal |
| Quality | Good | Excellent |
| CPU Usage | Moderate | Moderate |
| Hardware Accel | Limited | Widespread |

### Implementation Note
Use VP8 for broader compatibility, with VP9 as quality option when bandwidth allows.

---

## 7.3 Screen Capture: scrap vs Platform APIs

### Recommendation: scrap crate

- Cross-platform abstraction
- Rust-native
- Good performance
- Active maintenance

### Platform-Specific Alternatives
- Windows: DXGI Desktop Duplication API (lower latency)
- macOS: ScreenCaptureKit (modern, efficient)

Consider platform-specific implementations in Phase 4 for optimization.

---

## 7.4 Terminal: PTY vs SSH

### Recommendation: Native PTY

| Approach | Pros | Cons |
|----------|------|------|
| PTY (ConPTY/Unix PTY) | No extra services, fast, native | Platform-specific code |
| SSH | Standard protocol, existing tools | Requires SSH server, key management |

Native PTY via `portable-pty` crate provides:
- No dependency on external SSH server
- Works on Windows without OpenSSH
- Lower latency
- More control over session

---

# Part 8: Risk Analysis & Mitigation

## 8.1 Technical Risks

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| WebRTC NAT traversal failures | High | Medium | Robust TURN deployment, fallback modes |
| Screen capture permissions (macOS) | Medium | High | Clear user guidance, MDM pre-approval |
| Windows UAC complexity | High | Medium | Thorough testing, fallback to user-mode |
| Browser compatibility issues | Medium | Low | Standard WebRTC, progressive enhancement |
| Video encoding performance | Medium | Medium | Hardware acceleration, quality scaling |

## 8.2 Security Risks

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| Unauthorized access | Critical | Low | Multi-factor auth, permission model |
| Man-in-the-middle | Critical | Low | TLS, certificate pinning, DTLS |
| Agent compromise | Critical | Low | Code signing, integrity checks, minimal privileges |
| Credential theft | High | Low | Secure storage, hardware-backed keys |
| Session hijacking | High | Low | Short-lived tokens, connection binding |

## 8.3 Operational Risks

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| TURN server overload | High | Medium | Auto-scaling, geographic distribution |
| Agent update failures | Medium | Medium | Rollback capability, staged rollouts |
| Service outages | High | Low | HA deployment, circuit breakers |
| Compliance violations | High | Low | Audit logging, session recording |

---

# Part 9: Success Metrics

## 9.1 Performance Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| Connection time | < 3 seconds | Time from request to first frame |
| Video latency | < 100ms | Glass-to-glass latency |
| Input latency | < 50ms | Keystroke to screen update |
| Frame rate | 30 FPS sustained | Average during session |
| CPU usage (agent) | < 10% idle, < 30% active | System monitor |
| Memory usage (agent) | < 100MB | System monitor |
| Bandwidth | < 2 Mbps for 1080p | Network monitor |

## 9.2 Reliability Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| Connection success rate | > 99% | Successful / attempted |
| Session stability | > 99.9% uptime | Time connected / session duration |
| Agent uptime | > 99.9% | Heartbeat monitoring |
| TURN relay success | 100% when needed | Fallback success rate |

## 9.3 Security Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| Auth failure rate | < 0.1% legitimate | Failed / attempted |
| Security incidents | 0 | Incident reports |
| Vulnerability remediation | < 24h critical | Time to patch |
| Audit log completeness | 100% | Events logged / events occurred |

## 9.4 User Experience Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| User satisfaction | > 4.5/5 | Surveys |
| Feature adoption | > 80% | Active users / eligible users |
| Support tickets | < 5% of sessions | Tickets / sessions |
| Training time | < 15 minutes | New user onboarding |

---

# Appendices

## Appendix A: Glossary

| Term | Definition |
|------|------------|
| Agent | Software installed on remote machine |
| Data Channel | WebRTC mechanism for arbitrary data |
| DTLS | Datagram TLS, encryption for UDP |
| ICE | Interactive Connectivity Establishment |
| PTY | Pseudo-terminal |
| SDP | Session Description Protocol |
| SRTP | Secure Real-time Transport Protocol |
| STUN | Session Traversal Utilities for NAT |
| TURN | Traversal Using Relays around NAT |
| UAC | User Account Control (Windows) |
| WebRTC | Web Real-Time Communication |

## Appendix B: Reference Architecture Diagrams

See architecture diagrams in main document sections.

## Appendix C: API Specifications

Detailed OpenAPI/Swagger specifications to be developed during Phase 1.

## Appendix D: Security Compliance Mapping

| Requirement | SOC 2 | HIPAA | GDPR |
|-------------|-------|-------|------|
| Encryption in transit | CC6.1 | §164.312(e) | Art. 32 |
| Encryption at rest | CC6.1 | §164.312(a) | Art. 32 |
| Access controls | CC6.1 | §164.312(d) | Art. 25 |
| Audit logging | CC7.2 | §164.312(b) | Art. 30 |
| User consent | - | §164.508 | Art. 7 |
| Data minimization | - | - | Art. 5 |

---

*Document Version: 1.0*
*Last Updated: 2024*
*Authors: Engineering Team*
