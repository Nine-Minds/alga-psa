# Remote Desktop Phase 3: Enterprise Features

**Timeline:** Weeks 9-12
**Status:** In Progress

## Prerequisites
- ✅ Signaling server operational (Phase 1)
- ✅ Windows/macOS agents with screen capture, input, terminal (Phase 2)
- ✅ TURN server and enrollment system (Phase 2)

## Week 9: Windows System Service

### Goals
Enable UAC/Secure Desktop capture via LocalSystem service in Session 0.

### Tasks
- [x] Create `ee/remote-desktop-service` crate
  - [x] Add `windows-service` dependency to `Cargo.toml`
  - [x] Implement service control handler in `src/service.rs`
  - [x] Service lifecycle: start, stop, pause, continue
- [x] Session 0 isolation implementation
  - [x] Run as LocalSystem account
  - [x] Named pipe IPC: `\\.\pipe\alga-remote-desktop-service`
  - [x] Message protocol: `ServiceRequest`/`ServiceResponse` enums
- [x] UAC and Secure Desktop detection
  - [x] Monitor `WTS_SESSION_LOCK`/`WTS_SESSION_UNLOCK` events
  - [x] Desktop type detection via `GetUserObjectInformationW`
  - [x] Capture secure desktop via DDA/GDI in Session 0
- [ ] Service installer integration
  - [ ] `sc.exe create` wrapper in installer
  - [ ] Auto-start configuration
  - [ ] Service recovery options

### Files
- `ee/remote-desktop-service/Cargo.toml`
- `ee/remote-desktop-service/src/service.rs`
- `ee/remote-desktop-service/src/ipc.rs`
- `ee/remote-desktop-service/src/pipe_server.rs`
- `ee/remote-desktop-service/src/desktop.rs`
- `ee/remote-desktop-service/src/capture.rs`
- `ee/remote-desktop-agent/src/service_client.rs`

### Success Criteria
- [ ] Service installs and starts automatically
- [x] User-mode agent connects via named pipe
- [ ] UAC prompts visible in remote session
- [ ] No crashes on session switch

---

## Week 10: macOS Privileged Helper

### Goals
Pre-login access and elevated permissions via launchd daemon.

### Tasks
- [ ] Create privileged helper bundle
  - [ ] `ee/agents/macos/PrivilegedHelper/` structure
  - [ ] Info.plist with `SMPrivilegedExecutables`
  - [ ] XPC service interface in Swift/Objective-C
- [ ] launchd integration
  - [ ] Create `/Library/LaunchDaemons/com.alga.remote-desktop.helper.plist`
  - [ ] Run as root with `SessionCreate=true`
  - [ ] MachServices configuration
- [ ] Permission handling
  - [ ] Programmatic TCC database modification (requires SIP disabled or MDM)
  - [ ] Accessibility: `AXIsProcessTrusted()` check
  - [ ] Screen Recording: `CGPreflightScreenCaptureAccess()`
- [ ] Pre-login screen capture
  - [ ] CGDisplayStream in loginwindow context
  - [ ] Input injection via IOKit HID events
- [ ] PKG installer scaffolding
  - [ ] Install helper to `/Library/PrivilegedHelperTools/`
  - [ ] Load launchd plist via `launchctl bootstrap`

### Files
- `ee/agents/macos/PrivilegedHelper/main.m`
- `ee/agents/macos/PrivilegedHelper/Info.plist`
- `ee/agents/macos/PrivilegedHelper/com.alga.remote-desktop.helper.plist`
- `ee/agents/macos/src/xpc_client.rs`

### Success Criteria
- [ ] Helper installs and loads on boot
- [ ] Main agent communicates via XPC
- [ ] Pre-login screen accessible remotely
- [ ] Permissions granted without manual intervention (on MDM)

---

## Week 11: Installers & Permissions

### Goals
Production-ready installers and full permission model.

### Tasks

#### Windows MSI
- [ ] WiX Toolset 4 setup
  - [ ] Create `ee/installers/windows/Product.wxs`
  - [ ] Components: agent binary, service binary, config
  - [ ] Registry keys for auto-start
  - [ ] Custom action: install/start service
- [ ] Code signing
  - [ ] DigiCert/Sectigo certificate
  - [ ] `signtool.exe` integration in build script
  - [ ] Timestamp server configuration
- [ ] Silent install parameters
  - [ ] `msiexec /i /qn SERVER_URL=... ENROLLMENT_KEY=...`
  - [ ] Write to registry: `HKLM\SOFTWARE\Alga\RemoteDesktop`

#### macOS PKG
- [ ] Create `ee/installers/macos/build-pkg.sh`
  - [ ] `pkgbuild` for component package
  - [ ] `productbuild` for distribution package
  - [ ] Postinstall script: load launchd plist
- [ ] Code signing
  - [ ] Apple Developer ID certificate
  - [ ] `codesign --deep --force --verify --verbose`
  - [ ] Notarization via `xcrun notarytool`
- [ ] Silent install
  - [ ] `installer -pkg -target / -applyChoiceChangesXML`
  - [ ] Choices.xml for configuration injection

#### Permission Model
- [x] Database schema
  ```sql
  CREATE TABLE rd_permissions (
    permission_id UUID PRIMARY KEY,
    tenant VARCHAR NOT NULL,
    user_id UUID REFERENCES users(user_id),
    role_id UUID REFERENCES roles(role_id),
    permission_type VARCHAR NOT NULL, -- 'view', 'control', 'admin'
    resource_type VARCHAR, -- 'all', 'company', 'device', 'device_group'
    resource_id UUID,
    created_by UUID NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ,
    is_active BOOLEAN DEFAULT TRUE
  );
  ```
- [x] API endpoints
  - [x] POST `/api/v1/remote-desktop/permissions` - grant permission
  - [x] GET `/api/v1/remote-desktop/permissions` - list with filtering
  - [x] GET `/api/v1/remote-desktop/permissions/check` - check user permission
  - [x] PATCH `/api/v1/remote-desktop/permissions/:id` - update permission
  - [x] DELETE `/api/v1/remote-desktop/permissions/:id` - revoke
- [x] Permission checking logic
  - [x] Permission hierarchy: admin > control > view
  - [x] Resource scope: all > company > device
  - [x] Expiration and active status support

### Files
- [ ] `ee/installers/windows/Product.wxs`
- [ ] `ee/installers/windows/sign.ps1`
- [ ] `ee/installers/macos/build-pkg.sh`
- [ ] `ee/installers/macos/scripts/postinstall`
- [x] `server/migrations/20251205150000_add_remote_desktop_permissions.cjs`
- [x] `server/src/lib/api/controllers/ApiRemoteDesktopController.ts` (permission methods)
- [x] `server/src/app/api/v1/remote-desktop/permissions/route.ts`
- [x] `server/src/app/api/v1/remote-desktop/permissions/[permissionId]/route.ts`
- [x] `server/src/app/api/v1/remote-desktop/permissions/check/route.ts`

### Success Criteria
- [ ] MSI installs silently with parameters
- [ ] PKG installs and agent starts automatically
- [ ] Both installers properly signed and verified
- [x] Permissions API fully implemented
- [x] Permission check endpoint available for signaling integration

---

## Week 12: Audit Logging & File Transfer

### Goals
Compliance-ready audit trail and file transfer capability.

### Tasks

#### Audit Logging
- [x] Database schema
  ```sql
  CREATE TABLE rd_audit_logs (
    log_id UUID PRIMARY KEY,
    tenant VARCHAR NOT NULL,
    session_id UUID NOT NULL,
    user_id UUID NOT NULL,
    agent_id UUID NOT NULL,
    event_type VARCHAR NOT NULL, -- 'session_start', 'session_end', 'input_mouse', 'file_upload_start', etc.
    event_data JSONB,
    ip_address INET,
    user_agent TEXT,
    timestamp TIMESTAMPTZ(6) DEFAULT NOW()
  );
  CREATE INDEX idx_rd_audit_logs_timestamp ON rd_audit_logs(tenant, timestamp DESC);
  ```
- [ ] Logging integration
  - [ ] Log in signaling server on WebRTC connection
  - [ ] Log in agent on input events (batched every 5s)
  - [x] Log file transfers with checksums
- [x] Query API
  - [x] GET `/api/v1/remote-desktop/audit-logs` - list with filtering
  - [x] POST `/api/v1/remote-desktop/audit-logs` - create log entry
  - [x] GET `/api/v1/remote-desktop/audit-logs/export` - export to CSV

#### File Transfer
- [x] Protocol design
  - [x] Use WebRTC data channel (separate from terminal)
  - [x] Message types: `FileRequest`, `FileChunk`, `FileComplete`, `FileError`, etc.
  - [x] Chunking: 16KB chunks with sequence numbers
- [x] Agent implementation
  - [x] `ee/remote-desktop-agent/src/file_transfer/mod.rs`
  - [x] `ee/remote-desktop-agent/src/file_transfer/protocol.rs`
  - [x] `ee/remote-desktop-agent/src/file_transfer/transfer.rs`
  - [x] Upload: read local file, send chunks with SHA-256 checksum
  - [x] Download: receive chunks, write to temp, move on complete
  - [x] Resume: track completed chunks, request missing
- [x] Browser UI
  - [x] `server/src/components/remote-desktop/FileTransfer.tsx`
  - [x] File browser with directory navigation
  - [x] Drag-and-drop upload support
  - [x] Progress bar with cancel option
- [x] Security
  - [x] Path traversal prevention (canonical path validation)
  - [x] Size limits (default 1GB, configurable)
  - [ ] Virus scanning hook (optional integration)

#### Multi-Monitor Support
- [ ] Agent: enumerate displays
  - [ ] Windows: `EnumDisplayMonitors`
  - [ ] macOS: `CGGetActiveDisplayList`
- [ ] Browser: monitor selection dropdown
- [ ] Signaling: negotiate monitor index in SDP

#### Integration Testing
- [ ] End-to-end test suite
  - [ ] `ee/tests/integration/remote_desktop_enterprise.rs`
  - [ ] Test UAC capture (Windows VM)
  - [ ] Test pre-login (macOS VM)
  - [ ] Test permission denial
  - [ ] Test file transfer resume
  - [ ] Test audit log generation

#### Security Hardening
- [ ] Certificate pinning in agents
- [ ] Rate limiting on signaling endpoints
- [ ] Session timeout (configurable, default 8h)
- [ ] Automatic disconnection on user presence (optional)
- [ ] Encryption key rotation for data channels

### Files
- `server/migrations/XXX_remote_desktop_audit_logs.sql`
- `server/src/audit/remote_desktop.rs`
- `server/src/routes/remote_desktop_audit.rs`
- `ee/agents/common/src/file_transfer.rs`
- `ee/agents/windows/src/file_transfer_impl.rs`
- `ee/agents/macos/src/file_transfer_impl.rs`
- `ee/browser/components/FileTransfer.tsx`
- `ee/browser/components/MonitorSelector.tsx`
- `ee/tests/integration/remote_desktop_enterprise.rs`

### Success Criteria
- [ ] All session events logged to database
- [ ] Audit logs queryable via API
- [ ] Files transfer successfully (tested up to 500MB)
- [ ] Transfer resumes after network interruption
- [ ] Multi-monitor selection works on dual-screen setup
- [ ] Integration tests pass on Windows and macOS VMs
- [ ] No security warnings from static analysis tools

---

## Final Deliverables

### 1. Database
- [ ] `remote_desktop_permissions` table
- [ ] `remote_desktop_audit_logs` table
- [ ] Indexes for query performance

### 2. API
- [ ] Permission CRUD endpoints
- [ ] Audit log query endpoint
- [ ] Permission middleware integrated

### 3. Agent Binaries
- [ ] `alga-remote-desktop-service.exe` (Windows service)
- [ ] `com.alga.remote-desktop.helper` (macOS privileged helper)
- [ ] Both signed with production certificates

### 4. Installers
- [ ] `AlgaRemoteDesktop-{version}.msi` (Windows)
- [ ] `AlgaRemoteDesktop-{version}.pkg` (macOS)
- [ ] Both notarized/signed, support silent install

### 5. Browser
- [ ] File transfer UI component
- [ ] Multi-monitor selector
- [ ] Permission denied error handling

### 6. Documentation
- [ ] Deployment guide: `/ee/docs/remote-desktop-deployment.md`
- [ ] Permission model: `/ee/docs/remote-desktop-permissions.md`
- [ ] Audit logging: `/ee/docs/remote-desktop-audit.md`

---

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| Code signing delays | Obtain certificates in Week 9 |
| UAC capture unstable | Fallback to user-mode with warning banner |
| macOS SIP restrictions | Document MDM profile requirements |
| File transfer performance | Implement adaptive chunk sizing |
| Audit log volume | Partition by month, retention policy |

---

## Phase 3 Success Metrics
- [ ] Windows service handles UAC 100% of the time
- [ ] macOS helper enables pre-login access
- [ ] Installers deploy on 50+ test machines
- [ ] Permission model blocks unauthorized access (penetration test)
- [ ] Audit logs capture all events (compliance review)
- [ ] File transfer handles 1GB files reliably
- [ ] Zero critical security vulnerabilities (Dependabot, Snyk scan)
