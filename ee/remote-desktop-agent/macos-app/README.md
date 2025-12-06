# Remote Desktop Agent - macOS Application

This is the macOS native wrapper for the Remote Desktop Agent. It provides:

- Native macOS menu bar integration
- Permission handling (Screen Recording, Accessibility)
- Session consent dialogs
- Settings management

## Architecture

The application uses a Swift + Rust hybrid architecture:

```
┌─────────────────────────────────────┐
│         Swift Application           │
│  ┌─────────────────────────────┐   │
│  │    SwiftUI / AppKit UI      │   │
│  │  - StatusBarController      │   │
│  │  - PermissionManager        │   │
│  │  - Settings View            │   │
│  └─────────────────────────────┘   │
│              │ FFI                  │
│  ┌─────────────────────────────┐   │
│  │      AgentBridge.swift      │   │
│  │  (Swift ↔ Rust bindings)    │   │
│  └─────────────────────────────┘   │
└──────────────┼──────────────────────┘
               │
┌──────────────┼──────────────────────┐
│  ┌───────────▼─────────────────┐   │
│  │      rd_agent.h (FFI)       │   │
│  └─────────────────────────────┘   │
│  ┌─────────────────────────────┐   │
│  │     Rust Core Library       │   │
│  │  - WebRTC Signaling         │   │
│  │  - Screen Capture           │   │
│  │  - Input Injection          │   │
│  └─────────────────────────────┘   │
│         librd_agent.dylib          │
└─────────────────────────────────────┘
```

## Building

### Prerequisites

- macOS 13.0 or later
- Xcode 15.0+ with Command Line Tools
- Rust 1.75+ with `x86_64-apple-darwin` and `aarch64-apple-darwin` targets

### Build Steps

```bash
# Full build (Rust + Swift + App Bundle)
./build.sh

# Individual steps
./build.sh rust    # Build Rust library only
./build.sh swift   # Build Swift app only
./build.sh bundle  # Create app bundle
./build.sh sign    # Sign the app (requires SIGNING_IDENTITY)
./build.sh dmg     # Create DMG installer
./build.sh clean   # Clean all build artifacts
```

### Code Signing

To sign the app for distribution:

```bash
export SIGNING_IDENTITY="Developer ID Application: Your Name (TEAMID)"
./build.sh
```

## Project Structure

```
macos-app/
├── Package.swift           # Swift Package Manager manifest
├── build.sh                # Build script
├── README.md
├── RDAgentLib/
│   └── module.modulemap    # C library module map
└── RemoteDesktopAgent/
    └── Sources/
        ├── App.swift               # Main application entry
        ├── AgentBridge.swift       # Rust FFI bridge
        ├── AgentController.swift   # High-level agent control
        ├── PermissionManager.swift # macOS permissions
        ├── StatusBarController.swift # Menu bar UI
        └── BridgingHeader.h        # C header import
```

## Permissions

The agent requires two macOS permissions:

1. **Screen Recording** - To capture and share the screen
2. **Accessibility** - To inject mouse and keyboard events

These are requested automatically on first launch. Users can manage them in:
System Settings → Privacy & Security → Screen Recording / Accessibility

## Configuration

The agent configuration is stored at:
`~/Library/Application Support/RemoteDesktopAgent/config.json`

Example configuration:
```json
{
  "agent": {
    "agent_id": "uuid-here",
    "agent_name": "My MacBook",
    "connection_token": "token-from-server"
  },
  "server": {
    "signaling_url": "wss://psa.example.com/ws/rd-signal",
    "api_url": "https://psa.example.com/api"
  },
  "capture": {
    "fps": 30,
    "quality": 80,
    "max_width": 1920,
    "max_height": 1080
  },
  "network": {
    "stun_servers": ["stun:stun.l.google.com:19302"],
    "reconnect_interval_ms": 5000,
    "max_reconnect_attempts": 10
  },
  "logging": {
    "level": "info",
    "file": ""
  }
}
```

## Development

### Running in Development

```bash
# Build and run
swift build && .build/debug/RemoteDesktopAgent
```

### Debugging

Set `RUST_LOG=debug` for verbose Rust logging:
```bash
RUST_LOG=debug .build/debug/RemoteDesktopAgent
```
