# Remote Desktop Support - Phase 2: Core Features Implementation Plan

**Phase Duration**: Weeks 5-8 (4 weeks)
**Prerequisites**: Phase 1 complete (signaling server, basic agent, basic browser client)
**Document Version**: 1.0
**Last Updated**: 2025-12-05

---

## Executive Summary

Phase 2 builds upon the foundation established in Phase 1, adding critical features that transform the basic proof-of-concept into a production-ready remote desktop solution. This phase focuses on three major pillars:

1. **Complete Input Support**: Full keyboard and mouse control with all special keys and modifiers
2. **Terminal Access**: PTY-based terminal integration for command-line access
3. **Platform Expansion**: macOS agent development for cross-platform support

Additional infrastructure improvements include TURN server deployment for NAT traversal, agent enrollment system, and basic permissions framework.

---

## Table of Contents

- [Week 5: Enhanced Input & TURN Server](#week-5-enhanced-input--turn-server)
- [Week 6: Terminal Integration](#week-6-terminal-integration)
- [Week 7: macOS Agent](#week-7-macos-agent)
- [Week 8: Testing & Polish](#week-8-testing--polish)
- [Cross-Cutting Concerns](#cross-cutting-concerns)
- [Testing Strategy](#testing-strategy)
- [Success Criteria](#success-criteria)
- [Risk Management](#risk-management)

---

# Week 5: Enhanced Input & TURN Server

## Goals

- Complete keyboard support including all special keys, modifiers, and key combinations
- Deploy TURN server for NAT traversal
- Implement agent enrollment system
- Add basic permissions model

---

## 5.1 Complete Keyboard Support

### 5.1.1 Browser Client - Enhanced Keyboard Capture

**File**: `/ee/server/src/components/remote/KeyboardHandler.tsx` (new)

**Objective**: Capture all keyboard events including special keys and combinations that browsers normally trap

#### Tasks

- [ ] **Create KeyboardHandler component**
  - Create React component that handles keyboard event capture
  - Implement keyboard event prevention for remote session context
  - Handle browser-specific keyboard quirks (Firefox, Safari, Chrome)

  ```typescript
  interface KeyEvent {
    type: 'keydown' | 'keyup';
    key: string;           // e.g., "a", "Enter", "F1"
    code: string;          // e.g., "KeyA", "Enter", "F1"
    modifiers: {
      ctrl: boolean;
      alt: boolean;
      shift: boolean;
      meta: boolean;      // Windows/Cmd key
    };
    location: number;     // 0=standard, 1=left, 2=right, 3=numpad
  }
  ```

- [ ] **Implement special key mapping**
  - Map JavaScript key codes to platform-specific virtual key codes
  - Create lookup table for Windows virtual key codes
  - Create lookup table for macOS keycodes
  - Handle dead keys and IME composition events

  **File**: `/ee/server/src/lib/remote/keymap.ts` (new)

  ```typescript
  export const KEY_MAP_WINDOWS: Record<string, number> = {
    'F1': 0x70,
    'F2': 0x71,
    // ... F3-F12
    'PrintScreen': 0x2C,
    'ScrollLock': 0x91,
    'Pause': 0x13,
    'Insert': 0x2D,
    'Delete': 0x2E,
    'Home': 0x24,
    'End': 0x23,
    'PageUp': 0x21,
    'PageDown': 0x22,
    // Arrow keys
    'ArrowLeft': 0x25,
    'ArrowUp': 0x26,
    'ArrowRight': 0x27,
    'ArrowDown': 0x28,
    // Modifiers
    'ControlLeft': 0xA2,
    'ControlRight': 0xA3,
    'ShiftLeft': 0xA0,
    'ShiftRight': 0xA1,
    'AltLeft': 0xA4,
    'AltRight': 0xA5,
    'MetaLeft': 0x5B,  // Left Windows key
    'MetaRight': 0x5C, // Right Windows key
    // Media keys
    'AudioVolumeUp': 0xAF,
    'AudioVolumeDown': 0xAE,
    'AudioVolumeMute': 0xAD,
    // ... additional mappings
  };

  export const KEY_MAP_MACOS: Record<string, number> = {
    'F1': 0x7A,
    'F2': 0x78,
    // ... platform-specific mappings
  };
  ```

- [ ] **Handle special key combinations**
  - Implement Ctrl+Alt+Del handling (Windows)
  - Implement Cmd+Q, Cmd+W prevention/forwarding (macOS)
  - Handle browser shortcuts interception (F5, Ctrl+R, etc.)
  - Implement "Send Ctrl+Alt+Del" UI button (can't be captured from browser)

  **File**: `/ee/server/src/components/remote/SpecialKeysMenu.tsx` (new)

  ```typescript
  export const SpecialKeysMenu: React.FC<{dataChannel: RTCDataChannel}> = ({ dataChannel }) => {
    const sendCtrlAltDel = () => {
      dataChannel.send(JSON.stringify({
        type: 'special-key-combo',
        combo: 'ctrl-alt-del'
      }));
    };

    // Additional special combinations...
  };
  ```

- [ ] **Test keyboard capture**
  - Verify all F-keys (F1-F12) are captured
  - Verify all modifier combinations work (Ctrl+X, Ctrl+Shift+Esc, etc.)
  - Verify arrow keys, Home/End, PgUp/PgDown
  - Verify numpad keys are distinguished from main keyboard
  - Test on Chrome, Firefox, Safari, Edge

**Success Criteria**:
- All keyboard keys can be sent to remote machine
- Special combinations don't trigger browser actions
- Left/right modifiers are distinguished
- Works across all supported browsers

---

### 5.1.2 Agent - Enhanced Input Injection (Windows)

**File**: `/ee/agent/src/input/windows.rs`

**Objective**: Complete the Windows input injection implementation with all keyboard support

#### Tasks

- [ ] **Extend WindowsInputInjector with keyboard mapping**
  - Add method to convert web key codes to Windows VK codes
  - Implement modifier state tracking to ensure correct order
  - Handle extended keys (numpad, arrows) properly

  ```rust
  impl InputInjector {
      pub fn inject_key_event(&self, event: KeyEvent) -> Result<(), InputError> {
          let vk_code = map_key_to_vk(&event.code)?;

          // Handle extended keys
          let flags = if is_extended_key(vk_code) {
              if event.pressed {
                  KEYEVENTF_EXTENDEDKEY
              } else {
                  KEYEVENTF_EXTENDEDKEY | KEYEVENTF_KEYUP
              }
          } else {
              if event.pressed {
                  KEYBD_EVENT_FLAGS(0)
              } else {
                  KEYEVENTF_KEYUP
              }
          };

          unsafe {
              let input = INPUT {
                  r#type: INPUT_KEYBOARD,
                  Anonymous: INPUT_0 {
                      ki: KEYBDINPUT {
                          wVk: VIRTUAL_KEY(vk_code),
                          dwFlags: flags,
                          ..Default::default()
                      },
                  },
              };

              SendInput(&[input], std::mem::size_of::<INPUT>() as i32);
          }

          Ok(())
      }
  }

  fn map_key_to_vk(code: &str) -> Result<u16, InputError> {
      // Implementation matching keymap.ts
      match code {
          "F1" => Ok(0x70),
          "F2" => Ok(0x71),
          // ... complete mapping
          _ => Err(InputError::UnknownKey(code.to_string()))
      }
  }

  fn is_extended_key(vk: u16) -> bool {
      matches!(vk,
          0x21..=0x28 | // Page Up/Down, End, Home, Arrows
          0x2D | 0x2E | // Insert, Delete
          0x5B | 0x5C   // Windows keys
      )
  }
  ```

- [ ] **Implement modifier state management**
  - Track current modifier states to prevent stuck keys
  - Implement modifier synchronization on session start
  - Add periodic modifier state checks

  ```rust
  struct ModifierState {
      ctrl_left: bool,
      ctrl_right: bool,
      shift_left: bool,
      shift_right: bool,
      alt_left: bool,
      alt_right: bool,
      meta_left: bool,
      meta_right: bool,
  }

  impl ModifierState {
      fn sync_with_system(&mut self) -> Result<(), InputError> {
          unsafe {
              self.ctrl_left = (GetAsyncKeyState(VK_LCONTROL.0 as i32) & 0x8000) != 0;
              self.ctrl_right = (GetAsyncKeyState(VK_RCONTROL.0 as i32) & 0x8000) != 0;
              // ... sync all modifiers
          }
          Ok(())
      }

      fn release_all(&mut self) -> Result<(), InputError> {
          // Release any stuck modifiers
          if self.ctrl_left { /* send keyup */ }
          if self.ctrl_right { /* send keyup */ }
          // ... release all
          Ok(())
      }
  }
  ```

- [ ] **Implement special key combinations**
  - Handle Ctrl+Alt+Del via SendSAS API (requires SYSTEM privilege)
  - Handle secure desktop input forwarding
  - Add special handling for Windows key combinations

  **File**: `/ee/agent/src/input/secure_desktop.rs` (new)

  ```rust
  use windows::Win32::System::Shutdown::SendSAS;

  pub fn send_ctrl_alt_del() -> Result<(), InputError> {
      // This requires SE_TCB_NAME privilege (SYSTEM)
      // Called from elevated service component
      unsafe {
          SendSAS(false)?;
      }
      Ok(())
  }
  ```

- [ ] **Add keyboard debugging/logging**
  - Log all key events (in debug mode)
  - Add metrics for key injection latency
  - Implement key event validation

**Success Criteria**:
- All Windows virtual key codes supported
- Modifiers work correctly (Ctrl+C, Alt+Tab, Win+R, etc.)
- No stuck keys after rapid typing
- Special combinations reach the OS

---

### 5.1.3 Mouse Enhancement

**File**: `/ee/agent/src/input/windows.rs` and `/ee/server/src/components/remote/MouseHandler.tsx`

#### Tasks

- [ ] **Implement scroll wheel support**
  - Add wheel delta handling in browser
  - Implement MOUSEEVENTF_WHEEL in agent
  - Add horizontal scroll support (MOUSEEVENTF_HWHEEL)

  ```typescript
  // Browser side
  const handleWheel = useCallback((e: WheelEvent) => {
      e.preventDefault();
      dataChannel.send(JSON.stringify({
          type: 'mouse-wheel',
          deltaX: e.deltaX,
          deltaY: e.deltaY,
          deltaMode: e.deltaMode
      }));
  }, [dataChannel]);
  ```

  ```rust
  // Agent side
  pub fn inject_mouse_wheel(&self, delta_y: i32, delta_x: i32) -> Result<(), InputError> {
      // Vertical scroll
      if delta_y != 0 {
          let input = INPUT {
              r#type: INPUT_MOUSE,
              Anonymous: INPUT_0 {
                  mi: MOUSEINPUT {
                      dwFlags: MOUSEEVENTF_WHEEL,
                      mouseData: (delta_y * 120) as u32, // WHEEL_DELTA = 120
                      ..Default::default()
                  },
              },
          };
          unsafe { SendInput(&[input], std::mem::size_of::<INPUT>() as i32); }
      }

      // Horizontal scroll
      if delta_x != 0 {
          let input = INPUT {
              r#type: INPUT_MOUSE,
              Anonymous: INPUT_0 {
                  mi: MOUSEINPUT {
                      dwFlags: MOUSEEVENTF_HWHEEL,
                      mouseData: (delta_x * 120) as u32,
                      ..Default::default()
                  },
              },
          };
          unsafe { SendInput(&[input], std::mem::size_of::<INPUT>() as i32); }
      }

      Ok(())
  }
  ```

- [ ] **Implement additional mouse buttons**
  - Support Mouse4 (back) and Mouse5 (forward)
  - Add XBUTTON1/XBUTTON2 handling

  ```rust
  MouseButton::Back => (MOUSEEVENTF_XDOWN, XBUTTON1),
  MouseButton::Forward => (MOUSEEVENTF_XDOWN, XBUTTON2),
  ```

- [ ] **Add cursor position synchronization**
  - Send periodic cursor position updates to browser
  - Render remote cursor overlay in browser client
  - Handle cursor icon changes

**Success Criteria**:
- Scroll wheel works in both directions
- Additional mouse buttons function
- Cursor position stays synchronized

---

## 5.2 TURN Server Deployment

### 5.2.1 Deploy coturn

**Objective**: Deploy and configure coturn for NAT traversal

#### Tasks

- [ ] **Create coturn configuration**

  **File**: `/ee/infrastructure/coturn/turnserver.conf` (new)

  ```conf
  # Basic settings
  listening-port=3478
  tls-listening-port=5349

  # Realm and server name
  realm=remote.algapsa.com
  server-name=turn.algapsa.com

  # Authentication
  fingerprint
  lt-cred-mech
  use-auth-secret
  static-auth-secret=${TURN_STATIC_SECRET}

  # Security
  no-tlsv1
  no-tlsv1_1
  cipher-list="ECDHE-RSA-AES256-GCM-SHA384:ECDHE-RSA-AES128-GCM-SHA256"

  # Certificates (Let's Encrypt)
  cert=/etc/letsencrypt/live/turn.algapsa.com/cert.pem
  pkey=/etc/letsencrypt/live/turn.algapsa.com/privkey.pem

  # Relay settings
  relay-ip=${SERVER_IP}
  external-ip=${PUBLIC_IP}

  # Quotas
  total-quota=100
  max-bps=500000
  bps-capacity=0

  # Misc
  no-cli
  no-stdout-log
  log-file=/var/log/coturn/turnserver.log
  verbose
  ```

- [ ] **Create Kubernetes deployment**

  **File**: `/ee/infrastructure/k8s/coturn/deployment.yaml` (new)

  ```yaml
  apiVersion: apps/v1
  kind: Deployment
  metadata:
    name: coturn
    namespace: remote-desktop
  spec:
    replicas: 3  # Geographic distribution
    selector:
      matchLabels:
        app: coturn
    template:
      metadata:
        labels:
          app: coturn
      spec:
        containers:
        - name: coturn
          image: coturn/coturn:latest
          ports:
          - containerPort: 3478
            name: turn-udp
            protocol: UDP
          - containerPort: 3478
            name: turn-tcp
            protocol: TCP
          - containerPort: 5349
            name: turns-tcp
            protocol: TCP
          volumeMounts:
          - name: config
            mountPath: /etc/coturn
          - name: certs
            mountPath: /etc/letsencrypt
          env:
          - name: TURN_STATIC_SECRET
            valueFrom:
              secretKeyRef:
                name: coturn-secret
                key: static-secret
          - name: SERVER_IP
            valueFrom:
              fieldRef:
                fieldPath: status.podIP
          - name: PUBLIC_IP
            value: "AUTO"  # Use cloud provider metadata
          resources:
            requests:
              memory: "256Mi"
              cpu: "250m"
            limits:
              memory: "512Mi"
              cpu: "500m"
        volumes:
        - name: config
          configMap:
            name: coturn-config
        - name: certs
          secret:
            secretName: coturn-tls
  ---
  apiVersion: v1
  kind: Service
  metadata:
    name: coturn
    namespace: remote-desktop
  spec:
    type: LoadBalancer
    selector:
      app: coturn
    ports:
    - port: 3478
      targetPort: 3478
      protocol: UDP
      name: turn-udp
    - port: 3478
      targetPort: 3478
      protocol: TCP
      name: turn-tcp
    - port: 5349
      targetPort: 5349
      protocol: TCP
      name: turns-tcp
  ```

- [ ] **Implement TURN credential generation**

  **File**: `/ee/server/src/lib/remote/turn.ts` (new)

  ```typescript
  import crypto from 'crypto';

  interface TurnCredentials {
    urls: string[];
    username: string;
    credential: string;
    credentialType: 'password';
  }

  export function generateTurnCredentials(sessionId: string): TurnCredentials {
    const ttl = 24 * 3600; // 24 hours
    const timestamp = Math.floor(Date.now() / 1000) + ttl;
    const username = `${timestamp}:${sessionId}`;

    const secret = process.env.TURN_STATIC_SECRET!;
    const hmac = crypto.createHmac('sha1', secret);
    hmac.update(username);
    const credential = hmac.digest('base64');

    return {
      urls: [
        'stun:turn.algapsa.com:3478',
        'turn:turn.algapsa.com:3478?transport=udp',
        'turn:turn.algapsa.com:3478?transport=tcp',
        'turns:turn.algapsa.com:5349?transport=tcp',
      ],
      username,
      credential,
      credentialType: 'password',
    };
  }
  ```

- [ ] **Update session API to include TURN credentials**

  **File**: `/ee/server/src/app/api/remote/sessions/route.ts`

  ```typescript
  // In session creation endpoint
  const turnCredentials = generateTurnCredentials(session.id);

  return {
    sessionId: session.id,
    status: 'approved',
    iceServers: [
      { urls: 'stun:stun.algapsa.com:3478' },
      turnCredentials,
    ],
  };
  ```

- [ ] **Test NAT traversal**
  - Test direct connection (same network)
  - Test with symmetric NAT simulation
  - Test with firewall blocking UDP
  - Verify TURN relay activates correctly
  - Monitor TURN server metrics (relay vs direct connections)

**Success Criteria**:
- coturn deployed and running
- Credentials generated correctly
- NAT traversal works in restricted networks
- < 10% of connections require TURN relay in typical deployments

---

## 5.3 Agent Enrollment System

### 5.3.1 Enrollment Code Generation

**Objective**: Allow MSP admins to generate enrollment codes for agent installation

#### Tasks

- [ ] **Create database schema**

  **File**: `/ee/server/migrations/YYYYMMDDHHMMSS_remote_enrollment_codes.sql` (new)

  ```sql
  CREATE TABLE remote_enrollment_codes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    company_id UUID REFERENCES companies(id), -- Optional: restrict to company

    code VARCHAR(15) NOT NULL UNIQUE, -- Format: ABC-123-XYZ
    code_hash VARCHAR(64) NOT NULL, -- SHA-256 hash

    created_by UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL,

    usage_limit INTEGER NOT NULL DEFAULT 1,
    usage_count INTEGER NOT NULL DEFAULT 0,

    -- Default permissions for enrolled agents
    default_permissions JSONB NOT NULL DEFAULT '{
      "canConnect": true,
      "canViewScreen": true,
      "canControlInput": true,
      "canAccessTerminal": true,
      "canTransferFiles": true,
      "canElevate": false,
      "requiresUserConsent": true
    }'::jsonb,

    revoked_at TIMESTAMPTZ,
    revoked_by UUID REFERENCES users(id),

    CONSTRAINT valid_limits CHECK (usage_limit > 0 AND usage_count >= 0)
  );

  CREATE INDEX idx_enrollment_codes_tenant ON remote_enrollment_codes(tenant_id);
  CREATE INDEX idx_enrollment_codes_code_hash ON remote_enrollment_codes(code_hash);
  CREATE INDEX idx_enrollment_codes_expires ON remote_enrollment_codes(expires_at);
  ```

- [ ] **Implement code generation API**

  **File**: `/ee/server/src/app/api/remote/enrollment-codes/route.ts` (new)

  ```typescript
  import { NextRequest, NextResponse } from 'next/server';
  import crypto from 'crypto';

  const CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // No confusing chars

  function generateEnrollmentCode(): string {
    const segments = [];
    for (let i = 0; i < 3; i++) {
      let segment = '';
      for (let j = 0; j < 3; j++) {
        segment += CHARS[crypto.randomInt(CHARS.length)];
      }
      segments.push(segment);
    }
    return segments.join('-'); // e.g., "ABC-D3F-XY7"
  }

  function hashCode(code: string): string {
    return crypto.createHash('sha256').update(code).digest('hex');
  }

  export async function POST(req: NextRequest) {
    const session = await getSession(req);
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const {
      companyId,
      expiresInHours = 24,
      usageLimit = 1,
      permissions,
    } = body;

    // Validate permissions
    await checkUserPermission(session.user.id, 'remote:manage_enrollment');

    const code = generateEnrollmentCode();
    const codeHash = hashCode(code);
    const expiresAt = new Date(Date.now() + expiresInHours * 3600 * 1000);

    const enrollmentCode = await db.query(
      `INSERT INTO remote_enrollment_codes (
        tenant_id, company_id, code, code_hash,
        created_by, expires_at, usage_limit, default_permissions
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING id, code, expires_at, usage_limit`,
      [
        session.tenant.id,
        companyId || null,
        code,
        codeHash,
        session.user.id,
        expiresAt,
        usageLimit,
        JSON.stringify(permissions || {}),
      ]
    );

    return NextResponse.json({
      id: enrollmentCode.id,
      code: enrollmentCode.code, // Only returned once!
      expiresAt: enrollmentCode.expires_at,
      usageLimit: enrollmentCode.usage_limit,
    });
  }
  ```

- [ ] **Create UI for code generation**

  **File**: `/ee/server/src/app/(protected)/remote/enrollment/page.tsx` (new)

  ```typescript
  'use client';

  import { useState } from 'react';

  export default function EnrollmentPage() {
    const [code, setCode] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);

    const generateCode = async () => {
      setLoading(true);
      const response = await fetch('/api/remote/enrollment-codes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          expiresInHours: 24,
          usageLimit: 1,
        }),
      });

      const data = await response.json();
      setCode(data.code);
      setLoading(false);
    };

    return (
      <div className="enrollment-page">
        <h1>Agent Enrollment</h1>

        {!code ? (
          <button onClick={generateCode} disabled={loading}>
            {loading ? 'Generating...' : 'Generate Enrollment Code'}
          </button>
        ) : (
          <div className="code-display">
            <h2>Enrollment Code</h2>
            <div className="code">{code}</div>
            <p>This code expires in 24 hours.</p>
            <p>Share this code with the agent installer.</p>
            <button onClick={() => navigator.clipboard.writeText(code)}>
              Copy to Clipboard
            </button>
          </div>
        )}
      </div>
    );
  }
  ```

**Success Criteria**:
- Enrollment codes can be generated via UI and API
- Codes are unique and properly formatted
- Codes expire correctly
- Usage limits are enforced

---

### 5.3.2 Agent Enrollment Flow

**Objective**: Allow agents to enroll using codes

#### Tasks

- [ ] **Implement code validation endpoint**

  **File**: `/ee/server/src/app/api/remote/agents/enroll/route.ts` (new)

  ```typescript
  export async function POST(req: NextRequest) {
    const body = await req.json();
    const { enrollmentCode, machineId, hostname, osType, osVersion, agentVersion } = body;

    // Validate code
    const codeHash = hashCode(enrollmentCode);
    const code = await db.queryOne(
      `SELECT * FROM remote_enrollment_codes
       WHERE code_hash = $1
       AND expires_at > NOW()
       AND usage_count < usage_limit
       AND revoked_at IS NULL`,
      [codeHash]
    );

    if (!code) {
      return NextResponse.json(
        { error: 'Invalid or expired enrollment code' },
        { status: 403 }
      );
    }

    // Check if agent already exists
    const existingAgent = await db.queryOne(
      `SELECT id FROM remote_agents
       WHERE tenant_id = $1 AND machine_id = $2`,
      [code.tenant_id, machineId]
    );

    if (existingAgent) {
      return NextResponse.json(
        { error: 'Agent already enrolled' },
        { status: 409 }
      );
    }

    // Create agent record
    const agent = await db.queryOne(
      `INSERT INTO remote_agents (
        tenant_id, company_id, machine_id, hostname,
        os_type, os_version, agent_version, enrolled_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
      RETURNING id`,
      [
        code.tenant_id,
        code.company_id,
        machineId,
        hostname,
        osType,
        osVersion,
        agentVersion,
      ]
    );

    // Increment usage count
    await db.query(
      `UPDATE remote_enrollment_codes
       SET usage_count = usage_count + 1
       WHERE id = $1`,
      [code.id]
    );

    // Return configuration
    return NextResponse.json({
      agentId: agent.id,
      tenantId: code.tenant_id,
      signalingServer: 'wss://remote.algapsa.com/signal',
      permissions: code.default_permissions,
    });
  }
  ```

- [ ] **Implement agent-side enrollment**

  **File**: `/ee/agent/src/enrollment.rs` (new)

  ```rust
  use serde::{Deserialize, Serialize};
  use reqwest::Client;
  use machine_uid::get as get_machine_id;

  #[derive(Serialize)]
  struct EnrollmentRequest {
      enrollment_code: String,
      machine_id: String,
      hostname: String,
      os_type: String,
      os_version: String,
      agent_version: String,
  }

  #[derive(Deserialize)]
  struct EnrollmentResponse {
      agent_id: String,
      tenant_id: String,
      signaling_server: String,
      permissions: serde_json::Value,
  }

  pub async fn enroll(enrollment_code: String, server_url: String) -> Result<AgentConfig, EnrollmentError> {
      let machine_id = get_machine_id()?;
      let hostname = hostname::get()?.to_string_lossy().to_string();

      let os_info = os_info::get();
      let os_type = format!("{}", os_info.os_type());
      let os_version = format!("{}", os_info.version());

      let request = EnrollmentRequest {
          enrollment_code,
          machine_id,
          hostname,
          os_type,
          os_version,
          agent_version: env!("CARGO_PKG_VERSION").to_string(),
      };

      let client = Client::new();
      let response = client
          .post(format!("{}/api/remote/agents/enroll", server_url))
          .json(&request)
          .send()
          .await?;

      if !response.status().is_success() {
          let error = response.text().await?;
          return Err(EnrollmentError::ServerError(error));
      }

      let enrollment: EnrollmentResponse = response.json().await?;

      // Save configuration
      let config = AgentConfig {
          agent_id: enrollment.agent_id,
          tenant_id: enrollment.tenant_id,
          signaling_server: enrollment.signaling_server,
          permissions: enrollment.permissions,
      };

      save_config(&config)?;

      Ok(config)
  }
  ```

- [ ] **Add enrollment to installer**
  - Modify MSI to accept ENROLLMENT_CODE parameter
  - Add post-install action to trigger enrollment
  - Handle enrollment failures gracefully

**Success Criteria**:
- Agents can enroll using valid codes
- Invalid/expired codes are rejected
- Agent configuration is saved correctly
- Enrollment is idempotent (re-running doesn't create duplicates)

---

## 5.4 Basic Permissions Model

### 5.4.1 Permission Definitions

**Objective**: Define and enforce basic permission checks

#### Tasks

- [ ] **Define permission schema**

  **File**: `/ee/server/src/lib/remote/permissions.ts` (new)

  ```typescript
  export interface RemoteAccessPermission {
    canConnect: boolean;
    canViewScreen: boolean;
    canControlInput: boolean;
    canAccessTerminal: boolean;
    canTransferFiles: boolean;
    canElevate: boolean;
    requiresUserConsent: boolean;
    sessionDurationLimit?: number; // minutes
  }

  export const PERMISSION_PRESETS = {
    viewer: {
      canConnect: true,
      canViewScreen: true,
      canControlInput: false,
      canAccessTerminal: false,
      canTransferFiles: false,
      canElevate: false,
      requiresUserConsent: true,
    },
    technician: {
      canConnect: true,
      canViewScreen: true,
      canControlInput: true,
      canAccessTerminal: true,
      canTransferFiles: true,
      canElevate: false,
      requiresUserConsent: true,
    },
    admin: {
      canConnect: true,
      canViewScreen: true,
      canControlInput: true,
      canAccessTerminal: true,
      canTransferFiles: true,
      canElevate: true,
      requiresUserConsent: false,
    },
  };
  ```

- [ ] **Implement permission checks in session creation**

  **File**: `/ee/server/src/lib/remote/session-auth.ts` (new)

  ```typescript
  export async function checkSessionPermissions(
    userId: string,
    agentId: string,
    requestedCapabilities: string[]
  ): Promise<{ allowed: boolean; reason?: string; permissions?: RemoteAccessPermission }> {

    // Get user's role and permissions
    const userPermissions = await getUserRemotePermissions(userId);

    if (!userPermissions.canConnect) {
      return { allowed: false, reason: 'User lacks remote access permission' };
    }

    // Check each requested capability
    for (const capability of requestedCapabilities) {
      if (!userPermissions[capability as keyof RemoteAccessPermission]) {
        return {
          allowed: false,
          reason: `Permission '${capability}' not granted to user`,
        };
      }
    }

    return { allowed: true, permissions: userPermissions };
  }
  ```

- [ ] **Add permission checks to data channel messages**

  **File**: `/ee/server/src/lib/remote/signaling.ts`

  ```typescript
  // In WebSocket message handler
  if (message.type === 'data-channel-message') {
    const session = await getSession(message.sessionId);
    const permissions = session.permissions;

    // Check permission for action
    if (message.channel === 'input' && !permissions.canControlInput) {
      sendError(ws, 'Permission denied: canControlInput');
      return;
    }

    if (message.channel === 'terminal' && !permissions.canAccessTerminal) {
      sendError(ws, 'Permission denied: canAccessTerminal');
      return;
    }

    // Forward message...
  }
  ```

**Success Criteria**:
- Permission model defined and documented
- Session creation enforces permissions
- Data channel actions are permission-checked
- Unauthorized actions are blocked and logged

---

# Week 6: Terminal Integration

## Goals

- Implement PTY terminal integration in agent
- Add xterm.js terminal component to browser client
- Enable bi-directional terminal I/O over data channels
- Support terminal resize and basic terminal features

---

## 6.1 PTY Integration - Windows (ConPTY)

### 6.1.1 Agent PTY Implementation

**File**: `/ee/agent/src/terminal/mod.rs` (new)

**Objective**: Integrate Windows ConPTY via portable-pty crate

#### Tasks

- [ ] **Add dependencies to Cargo.toml**

  ```toml
  [dependencies]
  portable-pty = "0.8"
  tokio = { version = "1", features = ["io-util", "sync", "rt"] }
  ```

- [ ] **Create PTY terminal module**

  **File**: `/ee/agent/src/terminal/pty.rs` (new)

  ```rust
  use portable_pty::{CommandBuilder, PtySize, PtySystem, native_pty_system};
  use tokio::sync::mpsc;
  use std::io::{Read, Write};

  pub struct PtyTerminal {
      master: Box<dyn portable_pty::MasterPty + Send>,
      child: Box<dyn portable_pty::Child + Send>,
      size: PtySize,
  }

  impl PtyTerminal {
      pub fn new(cols: u16, rows: u16) -> Result<Self, PtyError> {
          let pty_system = native_pty_system();

          let size = PtySize {
              rows,
              cols,
              pixel_width: 0,
              pixel_height: 0,
          };

          let pair = pty_system.openpty(size)?;

          // Create shell command
          #[cfg(windows)]
          let cmd = {
              // Try PowerShell 7, fallback to PowerShell 5, then cmd.exe
              if let Ok(pwsh_path) = which::which("pwsh") {
                  CommandBuilder::new(pwsh_path)
              } else if let Ok(ps_path) = which::which("powershell") {
                  CommandBuilder::new(ps_path)
              } else {
                  CommandBuilder::new("cmd.exe")
              }
          };

          #[cfg(unix)]
          let cmd = {
              let shell = std::env::var("SHELL")
                  .unwrap_or_else(|_| "/bin/bash".to_string());
              let mut cmd = CommandBuilder::new(&shell);
              cmd.arg("-l"); // Login shell
              cmd
          };

          let child = pair.slave.spawn_command(cmd)?;

          Ok(Self {
              master: pair.master,
              child,
              size,
          })
      }

      pub fn resize(&mut self, cols: u16, rows: u16) -> Result<(), PtyError> {
          self.size = PtySize {
              rows,
              cols,
              pixel_width: 0,
              pixel_height: 0,
          };
          self.master.resize(self.size)?;
          Ok(())
      }

      pub fn write(&mut self, data: &[u8]) -> Result<usize, PtyError> {
          let mut writer = self.master.take_writer()?;
          let n = writer.write(data)?;
          writer.flush()?;
          Ok(n)
      }

      pub async fn read_loop(
          &mut self,
          mut output_tx: mpsc::Sender<Vec<u8>>,
          mut shutdown_rx: mpsc::Receiver<()>,
      ) -> Result<(), PtyError> {
          let mut reader = self.master.try_clone_reader()?;
          let mut buffer = [0u8; 8192];

          loop {
              tokio::select! {
                  _ = shutdown_rx.recv() => {
                      tracing::info!("PTY read loop shutting down");
                      break;
                  }
                  result = tokio::task::spawn_blocking({
                      let mut reader = reader.try_clone()?;
                      move || reader.read(&mut buffer)
                  }) => {
                      match result {
                          Ok(Ok(0)) => {
                              tracing::info!("PTY EOF");
                              break;
                          }
                          Ok(Ok(n)) => {
                              if output_tx.send(buffer[..n].to_vec()).await.is_err() {
                                  tracing::warn!("PTY output receiver dropped");
                                  break;
                              }
                          }
                          Ok(Err(e)) => {
                              tracing::error!("PTY read error: {}", e);
                              return Err(e.into());
                          }
                          Err(e) => {
                              tracing::error!("PTY read task panic: {}", e);
                              break;
                          }
                      }
                  }
              }
          }

          Ok(())
      }

      pub fn wait(&mut self) -> Result<ExitStatus, PtyError> {
          Ok(self.child.wait()?)
      }
  }

  #[derive(Debug)]
  pub struct ExitStatus {
      pub success: bool,
      pub code: Option<i32>,
  }

  #[derive(Debug, thiserror::Error)]
  pub enum PtyError {
      #[error("PTY system error: {0}")]
      SystemError(#[from] std::io::Error),
      #[error("PTY spawn error: {0}")]
      SpawnError(String),
  }
  ```

- [ ] **Integrate PTY with WebRTC data channel**

  **File**: `/ee/agent/src/session/terminal_handler.rs` (new)

  ```rust
  use crate::terminal::PtyTerminal;
  use tokio::sync::mpsc;
  use webrtc::data_channel::RTCDataChannel;
  use std::sync::Arc;

  pub struct TerminalHandler {
      pty: Option<PtyTerminal>,
      data_channel: Arc<RTCDataChannel>,
  }

  impl TerminalHandler {
      pub fn new(data_channel: Arc<RTCDataChannel>) -> Self {
          Self {
              pty: None,
              data_channel,
          }
      }

      pub async fn start(&mut self, cols: u16, rows: u16) -> Result<(), TerminalError> {
          if self.pty.is_some() {
              return Err(TerminalError::AlreadyStarted);
          }

          let mut pty = PtyTerminal::new(cols, rows)?;

          // Channel for PTY output
          let (output_tx, mut output_rx) = mpsc::channel::<Vec<u8>>(100);

          // Channel for shutdown signal
          let (shutdown_tx, shutdown_rx) = mpsc::channel::<()>(1);

          // Spawn read loop
          let mut pty_clone = pty.try_clone()?;
          tokio::spawn(async move {
              if let Err(e) = pty_clone.read_loop(output_tx, shutdown_rx).await {
                  tracing::error!("PTY read loop error: {}", e);
              }
          });

          // Forward PTY output to data channel
          let dc = self.data_channel.clone();
          tokio::spawn(async move {
              while let Some(data) = output_rx.recv().await {
                  let message = serde_json::json!({
                      "type": "pty-output",
                      "data": data,
                  }).to_string();

                  if let Err(e) = dc.send_text(message).await {
                      tracing::error!("Failed to send PTY output: {}", e);
                      break;
                  }
              }
          });

          self.pty = Some(pty);

          Ok(())
      }

      pub fn handle_input(&mut self, data: &[u8]) -> Result<(), TerminalError> {
          if let Some(pty) = &mut self.pty {
              pty.write(data)?;
              Ok(())
          } else {
              Err(TerminalError::NotStarted)
          }
      }

      pub fn handle_resize(&mut self, cols: u16, rows: u16) -> Result<(), TerminalError> {
          if let Some(pty) = &mut self.pty {
              pty.resize(cols, rows)?;
              Ok(())
          } else {
              Err(TerminalError::NotStarted)
          }
      }

      pub fn close(&mut self) -> Result<(), TerminalError> {
          if let Some(mut pty) = self.pty.take() {
              pty.wait()?;
          }
          Ok(())
      }
  }

  #[derive(Debug, thiserror::Error)]
  pub enum TerminalError {
      #[error("Terminal not started")]
      NotStarted,
      #[error("Terminal already started")]
      AlreadyStarted,
      #[error("PTY error: {0}")]
      PtyError(#[from] crate::terminal::PtyError),
  }
  ```

- [ ] **Add terminal data channel to session**

  **File**: `/ee/agent/src/session/mod.rs`

  ```rust
  // In WebRTCSession setup
  pub async fn setup_data_channels(&mut self) -> Result<(), SessionError> {
      // ... existing input channel setup ...

      // Create terminal data channel
      let terminal_dc = self.peer_connection
          .create_data_channel("terminal", None)
          .await?;

      let terminal_dc = Arc::new(terminal_dc);

      // Set up message handler
      let mut terminal_handler = TerminalHandler::new(Arc::clone(&terminal_dc));

      terminal_dc.on_message(Box::new(move |msg| {
          let data = msg.data.to_vec();
          let message: serde_json::Value = serde_json::from_slice(&data).unwrap();

          match message["type"].as_str() {
              Some("pty-start") => {
                  let cols = message["cols"].as_u64().unwrap() as u16;
                  let rows = message["rows"].as_u64().unwrap() as u16;

                  tokio::spawn(async move {
                      if let Err(e) = terminal_handler.start(cols, rows).await {
                          tracing::error!("Failed to start terminal: {}", e);
                      }
                  });
              }
              Some("pty-input") => {
                  let input = message["data"].as_array().unwrap()
                      .iter()
                      .map(|v| v.as_u64().unwrap() as u8)
                      .collect::<Vec<u8>>();

                  if let Err(e) = terminal_handler.handle_input(&input) {
                      tracing::error!("Failed to handle terminal input: {}", e);
                  }
              }
              Some("pty-resize") => {
                  let cols = message["cols"].as_u64().unwrap() as u16;
                  let rows = message["rows"].as_u64().unwrap() as u16;

                  if let Err(e) = terminal_handler.handle_resize(cols, rows) {
                      tracing::error!("Failed to resize terminal: {}", e);
                  }
              }
              Some("pty-close") => {
                  if let Err(e) = terminal_handler.close() {
                      tracing::error!("Failed to close terminal: {}", e);
                  }
              }
              _ => {
                  tracing::warn!("Unknown terminal message type");
              }
          }

          Box::pin(async {})
      }));

      self.data_channels.insert("terminal".to_string(), terminal_dc);

      Ok(())
  }
  ```

**Success Criteria**:
- PTY can be spawned successfully
- Output is captured and sent to data channel
- Input from data channel is written to PTY
- Terminal resize works correctly
- Process cleanup happens on session end

---

## 6.2 Browser Terminal Component

### 6.2.1 xterm.js Integration

**File**: `/ee/server/src/components/remote/RemoteTerminal.tsx` (new)

**Objective**: Integrate xterm.js for terminal display and interaction

#### Tasks

- [ ] **Install xterm.js dependencies**

  ```bash
  npm install xterm xterm-addon-fit xterm-addon-web-links
  npm install -D @types/xterm
  ```

- [ ] **Create RemoteTerminal component**

  ```typescript
  'use client';

  import React, { useRef, useEffect, useState } from 'react';
  import { Terminal } from 'xterm';
  import { FitAddon } from 'xterm-addon-fit';
  import { WebLinksAddon } from 'xterm-addon-web-links';
  import 'xterm/css/xterm.css';

  interface RemoteTerminalProps {
    dataChannel: RTCDataChannel | null;
    onClose: () => void;
  }

  export const RemoteTerminal: React.FC<RemoteTerminalProps> = ({
    dataChannel,
    onClose,
  }) => {
    const terminalRef = useRef<HTMLDivElement>(null);
    const termRef = useRef<Terminal | null>(null);
    const fitAddonRef = useRef<FitAddon | null>(null);
    const [isReady, setIsReady] = useState(false);

    useEffect(() => {
      if (!terminalRef.current || !dataChannel) return;

      // Create terminal
      const term = new Terminal({
        cursorBlink: true,
        fontSize: 14,
        fontFamily: 'JetBrains Mono, Menlo, Monaco, "Courier New", monospace',
        theme: {
          background: '#1e1e1e',
          foreground: '#d4d4d4',
          cursor: '#ffffff',
          selection: 'rgba(255, 255, 255, 0.3)',
          black: '#000000',
          red: '#cd3131',
          green: '#0dbc79',
          yellow: '#e5e510',
          blue: '#2472c8',
          magenta: '#bc3fbc',
          cyan: '#11a8cd',
          white: '#e5e5e5',
          brightBlack: '#666666',
          brightRed: '#f14c4c',
          brightGreen: '#23d18b',
          brightYellow: '#f5f543',
          brightBlue: '#3b8eea',
          brightMagenta: '#d670d6',
          brightCyan: '#29b8db',
          brightWhite: '#ffffff',
        },
        allowProposedApi: true,
      });

      const fitAddon = new FitAddon();
      term.loadAddon(fitAddon);
      term.loadAddon(new WebLinksAddon());

      term.open(terminalRef.current);
      fitAddon.fit();

      termRef.current = term;
      fitAddonRef.current = fitAddon;

      // Send terminal start message
      const initialSize = {
        cols: term.cols,
        rows: term.rows,
      };

      dataChannel.send(JSON.stringify({
        type: 'pty-start',
        cols: initialSize.cols,
        rows: initialSize.rows,
      }));

      setIsReady(true);

      // Handle incoming data
      const handleMessage = (event: MessageEvent) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'pty-output') {
            const bytes = new Uint8Array(data.data);
            term.write(bytes);
          }
        } catch (e) {
          console.error('Failed to handle terminal message:', e);
        }
      };

      dataChannel.addEventListener('message', handleMessage);

      // Send user input
      term.onData((data) => {
        if (dataChannel.readyState === 'open') {
          dataChannel.send(JSON.stringify({
            type: 'pty-input',
            data: Array.from(new TextEncoder().encode(data)),
          }));
        }
      });

      // Handle resize
      term.onResize(({ cols, rows }) => {
        if (dataChannel.readyState === 'open') {
          dataChannel.send(JSON.stringify({
            type: 'pty-resize',
            cols,
            rows,
          }));
        }
      });

      // Window resize handler
      const handleResize = () => {
        fitAddon.fit();
      };

      window.addEventListener('resize', handleResize);

      // Resize observer for container
      const resizeObserver = new ResizeObserver(() => {
        fitAddon.fit();
      });

      if (terminalRef.current) {
        resizeObserver.observe(terminalRef.current);
      }

      // Cleanup
      return () => {
        window.removeEventListener('resize', handleResize);
        resizeObserver.disconnect();
        dataChannel.removeEventListener('message', handleMessage);

        if (dataChannel.readyState === 'open') {
          dataChannel.send(JSON.stringify({ type: 'pty-close' }));
        }

        term.dispose();
      };
    }, [dataChannel]);

    return (
      <div className="remote-terminal">
        <div className="terminal-header">
          <span className="terminal-title">
            {isReady ? '● Terminal' : '○ Connecting...'}
          </span>
          <button onClick={onClose} className="close-button">×</button>
        </div>
        <div ref={terminalRef} className="terminal-container" />
      </div>
    );
  };
  ```

- [ ] **Add terminal styling**

  **File**: `/ee/server/src/styles/remote-terminal.css` (new)

  ```css
  .remote-terminal {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: #1e1e1e;
    border-radius: 4px;
    overflow: hidden;
  }

  .terminal-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 8px 12px;
    background: #2d2d2d;
    border-bottom: 1px solid #3e3e3e;
  }

  .terminal-title {
    font-size: 13px;
    color: #cccccc;
    font-weight: 500;
  }

  .close-button {
    background: none;
    border: none;
    color: #cccccc;
    font-size: 20px;
    cursor: pointer;
    padding: 0;
    width: 24px;
    height: 24px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 2px;
  }

  .close-button:hover {
    background: #3e3e3e;
  }

  .terminal-container {
    flex: 1;
    padding: 8px;
    overflow: hidden;
  }

  /* Ensure xterm.js terminal fills container */
  .terminal-container .xterm {
    height: 100%;
  }

  .terminal-container .xterm-viewport {
    overflow-y: auto !important;
  }
  ```

- [ ] **Integrate terminal into remote session UI**

  **File**: `/ee/server/src/components/remote/RemoteSessionView.tsx`

  ```typescript
  export const RemoteSessionView: React.FC<{sessionId: string}> = ({ sessionId }) => {
    const [showTerminal, setShowTerminal] = useState(false);
    const [terminalDataChannel, setTerminalDataChannel] = useState<RTCDataChannel | null>(null);

    // ... existing desktop viewer setup ...

    useEffect(() => {
      // When peer connection is established
      peerConnection.ondatachannel = (event) => {
        if (event.channel.label === 'terminal') {
          setTerminalDataChannel(event.channel);
        }
      };
    }, [peerConnection]);

    return (
      <div className="remote-session-view">
        <div className="toolbar">
          <button onClick={() => setShowTerminal(!showTerminal)}>
            {showTerminal ? 'Hide Terminal' : 'Show Terminal'}
          </button>
        </div>

        <div className="session-content">
          <div className="desktop-view">
            <DesktopViewer sessionId={sessionId} />
          </div>

          {showTerminal && terminalDataChannel && (
            <div className="terminal-panel">
              <RemoteTerminal
                dataChannel={terminalDataChannel}
                onClose={() => setShowTerminal(false)}
              />
            </div>
          )}
        </div>
      </div>
    );
  };
  ```

**Success Criteria**:
- Terminal renders correctly
- Text input/output works
- Terminal resizes with window
- Colors and formatting display correctly
- Links are clickable (via WebLinksAddon)

---

## 6.3 Terminal Features & Testing

### 6.3.1 Advanced Terminal Features

#### Tasks

- [ ] **Implement clipboard integration**
  - Add copy/paste support in xterm.js
  - Handle clipboard access permissions

  ```typescript
  // In RemoteTerminal component
  useEffect(() => {
    if (!termRef.current) return;

    const term = termRef.current;

    // Copy selection
    term.attachCustomKeyEventHandler((event) => {
      if (event.ctrlKey && event.key === 'c' && term.hasSelection()) {
        const selection = term.getSelection();
        navigator.clipboard.writeText(selection);
        return false;
      }

      // Paste from clipboard
      if (event.ctrlKey && event.key === 'v') {
        navigator.clipboard.readText().then(text => {
          term.paste(text);
        });
        return false;
      }

      return true;
    });
  }, []);
  ```

- [ ] **Add terminal history/scrollback**
  - Configure scrollback buffer size
  - Implement scroll-to-top/bottom buttons

  ```typescript
  const term = new Terminal({
    // ... other options
    scrollback: 10000, // 10k lines
  });
  ```

- [ ] **Implement search in terminal**
  - Add xterm-addon-search
  - Add search UI

  ```bash
  npm install xterm-addon-search
  ```

  ```typescript
  import { SearchAddon } from 'xterm-addon-search';

  const searchAddon = new SearchAddon();
  term.loadAddon(searchAddon);

  // Search UI
  const search = (query: string) => {
    searchAddon.findNext(query, { caseSensitive: false });
  };
  ```

**Success Criteria**:
- Copy/paste works correctly
- Scrollback retains history
- Search finds text in terminal

---

# Week 7: macOS Agent

## Goals

- Port Windows agent to macOS
- Implement macOS-specific screen capture
- Implement macOS-specific input injection
- Handle macOS permissions (Accessibility, Screen Recording)
- Create basic macOS installer (PKG)

---

## 7.1 macOS Agent Core

### 7.1.1 Project Setup

**Objective**: Set up macOS-specific build configuration

#### Tasks

- [ ] **Update Cargo.toml with macOS dependencies**

  **File**: `/ee/agent/Cargo.toml`

  ```toml
  [target.'cfg(target_os = "macos")'.dependencies]
  cocoa = "0.25"
  objc = "0.2"
  core-graphics = "0.23"
  core-foundation = "0.9"
  core-video = "0.2"
  ```

- [ ] **Create macOS platform module**

  **File**: `/ee/agent/src/platform/macos.rs` (new)

  ```rust
  pub mod screen_capture;
  pub mod input_injection;
  pub mod permissions;
  pub mod service;

  pub use screen_capture::MacOSScreenCapturer;
  pub use input_injection::MacOSInputInjector;
  pub use permissions::{check_permissions, request_permissions};
  ```

- [ ] **Set up conditional compilation**

  **File**: `/ee/agent/src/platform/mod.rs`

  ```rust
  #[cfg(target_os = "windows")]
  pub mod windows;

  #[cfg(target_os = "macos")]
  pub mod macos;

  #[cfg(target_os = "windows")]
  pub use windows::*;

  #[cfg(target_os = "macos")]
  pub use macos::*;
  ```

**Success Criteria**:
- Project compiles on macOS
- Platform-specific modules are properly isolated
- No Windows-specific code is compiled on macOS

---

### 7.1.2 macOS Screen Capture

**File**: `/ee/agent/src/platform/macos/screen_capture.rs` (new)

**Objective**: Implement screen capture using scrap crate (cross-platform) or ScreenCaptureKit

#### Tasks

- [ ] **Implement basic screen capture with scrap**

  ```rust
  use scrap::{Capturer, Display};
  use std::time::Duration;

  pub struct MacOSScreenCapturer {
      capturer: Capturer,
      width: usize,
      height: usize,
  }

  impl MacOSScreenCapturer {
      pub fn new(display_index: usize) -> Result<Self, CaptureError> {
          let displays = Display::all()?;
          let display = displays.into_iter().nth(display_index)
              .ok_or(CaptureError::DisplayNotFound)?;

          let capturer = Capturer::new(display)?;
          let width = capturer.width();
          let height = capturer.height();

          Ok(Self {
              capturer,
              width,
              height,
          })
      }

      pub fn capture_frame(&mut self) -> Result<Frame, CaptureError> {
          match self.capturer.frame() {
              Ok(buffer) => {
                  Ok(Frame {
                      data: buffer.to_vec(),
                      width: self.width,
                      height: self.height,
                      format: PixelFormat::Bgra8,
                      timestamp: std::time::SystemTime::now(),
                  })
              }
              Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                  Err(CaptureError::WouldBlock)
              }
              Err(e) => Err(CaptureError::IoError(e)),
          }
      }
  }
  ```

- [ ] **Add display enumeration**

  ```rust
  pub fn list_displays() -> Result<Vec<DisplayInfo>, CaptureError> {
      let displays = Display::all()?;

      Ok(displays.into_iter().enumerate().map(|(index, display)| {
          DisplayInfo {
              index,
              width: display.width(),
              height: display.height(),
              is_primary: index == 0, // Approximation
          }
      }).collect())
  }
  ```

- [ ] **Handle Retina displays**
  - Account for scale factor
  - Provide both logical and physical dimensions

  ```rust
  use core_graphics::display::{CGDisplay, CGMainDisplayID};

  pub fn get_display_scale_factor(display_id: u32) -> f64 {
      unsafe {
          let display = CGDisplay::new(display_id);
          // Get backing scale factor (1.0 for non-Retina, 2.0 for Retina)
          display.pixels_wide() as f64 / display.bounds().size.width
      }
  }
  ```

**Success Criteria**:
- Screen capture works on macOS
- Multiple displays can be enumerated
- Retina displays are handled correctly
- Frame rate is acceptable (>30fps)

---

### 7.1.3 macOS Input Injection

**File**: `/ee/agent/src/platform/macos/input_injection.rs` (new)

**Objective**: Implement mouse and keyboard injection using Core Graphics

#### Tasks

- [ ] **Implement mouse input injection**

  ```rust
  use core_graphics::event::{
      CGEvent, CGEventTapLocation, CGEventType, CGMouseButton, EventField,
  };
  use core_graphics::event_source::{CGEventSource, CGEventSourceStateID};
  use core_graphics::geometry::CGPoint;

  pub struct MacOSInputInjector {
      event_source: CGEventSource,
  }

  impl MacOSInputInjector {
      pub fn new() -> Result<Self, InputError> {
          let event_source = CGEventSource::new(CGEventSourceStateID::HIDSystemState)
              .map_err(|_| InputError::InitializationFailed)?;

          Ok(Self { event_source })
      }

      pub fn inject_mouse_move(&self, x: f64, y: f64) -> Result<(), InputError> {
          let point = CGPoint::new(x, y);

          let event = CGEvent::new_mouse_event(
              self.event_source.clone(),
              CGEventType::MouseMoved,
              point,
              CGMouseButton::Left, // Ignored for move events
          ).map_err(|_| InputError::EventCreationFailed)?;

          event.post(CGEventTapLocation::HID);
          Ok(())
      }

      pub fn inject_mouse_button(
          &self,
          button: MouseButton,
          pressed: bool,
          x: f64,
          y: f64,
      ) -> Result<(), InputError> {
          let point = CGPoint::new(x, y);

          let (cg_button, event_type) = match (button, pressed) {
              (MouseButton::Left, true) => {
                  (CGMouseButton::Left, CGEventType::LeftMouseDown)
              }
              (MouseButton::Left, false) => {
                  (CGMouseButton::Left, CGEventType::LeftMouseUp)
              }
              (MouseButton::Right, true) => {
                  (CGMouseButton::Right, CGEventType::RightMouseDown)
              }
              (MouseButton::Right, false) => {
                  (CGMouseButton::Right, CGEventType::RightMouseUp)
              }
              (MouseButton::Middle, true) => {
                  (CGMouseButton::Center, CGEventType::OtherMouseDown)
              }
              (MouseButton::Middle, false) => {
                  (CGMouseButton::Center, CGEventType::OtherMouseUp)
              }
              _ => return Err(InputError::UnsupportedButton),
          };

          let event = CGEvent::new_mouse_event(
              self.event_source.clone(),
              event_type,
              point,
              cg_button,
          ).map_err(|_| InputError::EventCreationFailed)?;

          event.post(CGEventTapLocation::HID);
          Ok(())
      }

      pub fn inject_mouse_wheel(&self, delta_y: i32, delta_x: i32) -> Result<(), InputError> {
          let event = CGEvent::new_scroll_event(
              self.event_source.clone(),
              ScrollEventUnit::Line,
              2, // wheel count
              delta_y,
              delta_x,
              0,
          ).map_err(|_| InputError::EventCreationFailed)?;

          event.post(CGEventTapLocation::HID);
          Ok(())
      }
  }
  ```

- [ ] **Implement keyboard input injection**

  ```rust
  pub fn inject_key(&self, keycode: u16, pressed: bool) -> Result<(), InputError> {
      let event = CGEvent::new_keyboard_event(
          self.event_source.clone(),
          keycode,
          pressed,
      ).map_err(|_| InputError::EventCreationFailed)?;

      event.post(CGEventTapLocation::HID);
      Ok(())
  }

  pub fn inject_key_with_modifiers(
      &self,
      keycode: u16,
      modifiers: KeyModifiers,
      pressed: bool,
  ) -> Result<(), InputError> {
      let event = CGEvent::new_keyboard_event(
          self.event_source.clone(),
          keycode,
          pressed,
      ).map_err(|_| InputError::EventCreationFailed)?;

      // Set modifier flags
      let mut flags = CGEventFlags::empty();
      if modifiers.command { flags |= CGEventFlags::CGEventFlagCommand; }
      if modifiers.shift { flags |= CGEventFlags::CGEventFlagShift; }
      if modifiers.option { flags |= CGEventFlags::CGEventFlagAlternate; }
      if modifiers.control { flags |= CGEventFlags::CGEventFlagControl; }

      event.set_flags(flags);
      event.post(CGEventTapLocation::HID);

      Ok(())
  }
  ```

- [ ] **Create key mapping for macOS**

  **File**: `/ee/agent/src/platform/macos/keymap.rs` (new)

  ```rust
  // macOS key codes (from IOKit/hidsystem/ev_keymap.h)
  pub const KEY_MAP: &[(&str, u16)] = &[
      ("KeyA", 0x00),
      ("KeyS", 0x01),
      // ... full mapping

      // Function keys
      ("F1", 0x7A),
      ("F2", 0x78),
      ("F3", 0x63),
      // ... F4-F12

      // Modifiers
      ("ShiftLeft", 0x38),
      ("ShiftRight", 0x3C),
      ("ControlLeft", 0x3B),
      ("ControlRight", 0x3E),
      ("AltLeft", 0x3A),      // Option
      ("AltRight", 0x3D),     // Option
      ("MetaLeft", 0x37),     // Command
      ("MetaRight", 0x36),    // Command

      // Arrow keys
      ("ArrowLeft", 0x7B),
      ("ArrowRight", 0x7C),
      ("ArrowDown", 0x7D),
      ("ArrowUp", 0x7E),

      // Special keys
      ("Escape", 0x35),
      ("Delete", 0x33),       // Backspace
      ("ForwardDelete", 0x75), // Delete
      ("Home", 0x73),
      ("End", 0x77),
      ("PageUp", 0x74),
      ("PageDown", 0x79),
      ("Enter", 0x24),
      ("Space", 0x31),
      ("Tab", 0x30),
  ];

  pub fn map_key_to_macos(code: &str) -> Result<u16, InputError> {
      KEY_MAP.iter()
          .find(|(k, _)| *k == code)
          .map(|(_, v)| *v)
          .ok_or(InputError::UnknownKey(code.to_string()))
  }
  ```

**Success Criteria**:
- Mouse moves and clicks work
- Scroll wheel works
- All keyboard keys are mapped correctly
- Modifier keys (Cmd, Option, Control, Shift) work
- Special keys (arrows, function keys) work

---

### 7.1.4 macOS Permissions Handling

**File**: `/ee/agent/src/platform/macos/permissions.rs` (new)

**Objective**: Check and request required macOS permissions

#### Tasks

- [ ] **Implement permission checks**

  ```rust
  use core_graphics::access::ScreenCaptureAccess;
  use std::process::Command;

  #[derive(Debug, Clone)]
  pub struct PermissionStatus {
      pub screen_recording: bool,
      pub accessibility: bool,
  }

  pub fn check_permissions() -> PermissionStatus {
      let screen_recording = check_screen_recording_permission();
      let accessibility = check_accessibility_permission();

      PermissionStatus {
          screen_recording,
          accessibility,
      }
  }

  fn check_screen_recording_permission() -> bool {
      // Preflight check
      ScreenCaptureAccess::preflight()
  }

  fn check_accessibility_permission() -> bool {
      unsafe {
          use objc::{class, msg_send, sel, sel_impl};
          use objc::runtime::Object;

          let options: *mut Object = msg_send![class!(NSDictionary), dictionary];
          let trusted: bool = msg_send![
              class!(AXIsProcessTrustedWithOptions),
              call: options
          ];

          trusted
      }
  }

  pub fn request_screen_recording_permission() {
      // Open System Preferences to Screen Recording pane
      let _ = Command::new("open")
          .arg("x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture")
          .spawn();
  }

  pub fn request_accessibility_permission() {
      // Open System Preferences to Accessibility pane
      let _ = Command::new("open")
          .arg("x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility")
          .spawn();
  }
  ```

- [ ] **Add permission check to agent startup**

  **File**: `/ee/agent/src/main.rs`

  ```rust
  #[cfg(target_os = "macos")]
  fn check_macos_permissions() -> Result<(), String> {
      use crate::platform::macos::permissions;

      let status = permissions::check_permissions();

      if !status.screen_recording {
          eprintln!("Screen recording permission not granted");
          permissions::request_screen_recording_permission();
          return Err("Screen recording permission required".to_string());
      }

      if !status.accessibility {
          eprintln!("Accessibility permission not granted");
          permissions::request_accessibility_permission();
          return Err("Accessibility permission required".to_string());
      }

      Ok(())
  }

  #[tokio::main]
  async fn main() -> Result<(), Box<dyn std::error::Error>> {
      #[cfg(target_os = "macos")]
      check_macos_permissions()?;

      // ... rest of agent initialization
  }
  ```

- [ ] **Create helper UI for permission requests**
  - Show dialog explaining why permissions are needed
  - Provide "Open System Preferences" button
  - Retry after permissions granted

**Success Criteria**:
- Agent can detect missing permissions
- System Preferences opens to correct pane
- Agent works after permissions granted

---

## 7.2 macOS Service/Daemon

### 7.2.1 LaunchDaemon Configuration

**Objective**: Set up agent to run as system daemon via launchd

#### Tasks

- [ ] **Create launchd plist**

  **File**: `/ee/agent/resources/macos/com.algapsa.remote-agent.plist` (new)

  ```xml
  <?xml version="1.0" encoding="UTF-8"?>
  <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
  <plist version="1.0">
  <dict>
      <key>Label</key>
      <string>com.algapsa.remote-agent</string>

      <key>ProgramArguments</key>
      <array>
          <string>/Applications/Alga Remote Agent.app/Contents/MacOS/alga-remote-agent</string>
      </array>

      <key>RunAtLoad</key>
      <true/>

      <key>KeepAlive</key>
      <dict>
          <key>SuccessfulExit</key>
          <false/>
      </dict>

      <key>StandardOutPath</key>
      <string>/Library/Logs/AlgaRemoteAgent/stdout.log</string>

      <key>StandardErrorPath</key>
      <string>/Library/Logs/AlgaRemoteAgent/stderr.log</string>

      <key>EnvironmentVariables</key>
      <dict>
          <key>RUST_LOG</key>
          <string>info</string>
      </dict>
  </dict>
  </plist>
  ```

- [ ] **Implement service management commands**

  **File**: `/ee/agent/src/platform/macos/service.rs` (new)

  ```rust
  use std::process::Command;

  const PLIST_PATH: &str = "/Library/LaunchDaemons/com.algapsa.remote-agent.plist";
  const LABEL: &str = "com.algapsa.remote-agent";

  pub fn install_service() -> Result<(), ServiceError> {
      // Copy plist to LaunchDaemons
      std::fs::copy(
          "/tmp/com.algapsa.remote-agent.plist",
          PLIST_PATH,
      )?;

      // Load service
      Command::new("launchctl")
          .args(&["load", PLIST_PATH])
          .status()?;

      Ok(())
  }

  pub fn uninstall_service() -> Result<(), ServiceError> {
      // Unload service
      Command::new("launchctl")
          .args(&["unload", PLIST_PATH])
          .status()?;

      // Remove plist
      std::fs::remove_file(PLIST_PATH)?;

      Ok(())
  }

  pub fn start_service() -> Result<(), ServiceError> {
      Command::new("launchctl")
          .args(&["start", LABEL])
          .status()?;

      Ok(())
  }

  pub fn stop_service() -> Result<(), ServiceError> {
      Command::new("launchctl")
          .args(&["stop", LABEL])
          .status()?;

      Ok(())
  }
  ```

**Success Criteria**:
- Agent runs as system daemon
- Agent starts automatically on boot
- Agent restarts on crash
- Logs are written to correct location

---

## 7.3 macOS Installer

### 7.3.1 PKG Installer Creation

**Objective**: Create macOS installer package

#### Tasks

- [ ] **Create build script**

  **File**: `/ee/agent/scripts/build-macos-pkg.sh` (new)

  ```bash
  #!/bin/bash
  set -e

  VERSION="0.1.0"
  IDENTIFIER="com.algapsa.remote-agent"
  APP_NAME="Alga Remote Agent"

  # Build release binary
  cargo build --release --target x86_64-apple-darwin
  cargo build --release --target aarch64-apple-darwin

  # Create universal binary
  lipo -create \
      target/x86_64-apple-darwin/release/alga-remote-agent \
      target/aarch64-apple-darwin/release/alga-remote-agent \
      -output target/release/alga-remote-agent

  # Create app bundle structure
  mkdir -p "dist/$APP_NAME.app/Contents/MacOS"
  mkdir -p "dist/$APP_NAME.app/Contents/Resources"

  # Copy binary
  cp target/release/alga-remote-agent "dist/$APP_NAME.app/Contents/MacOS/"

  # Create Info.plist
  cat > "dist/$APP_NAME.app/Contents/Info.plist" << 'EOF'
  <?xml version="1.0" encoding="UTF-8"?>
  <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
  <plist version="1.0">
  <dict>
      <key>CFBundleExecutable</key>
      <string>alga-remote-agent</string>
      <key>CFBundleIdentifier</key>
      <string>com.algapsa.remote-agent</string>
      <key>CFBundleName</key>
      <string>Alga Remote Agent</string>
      <key>CFBundleVersion</key>
      <string>VERSION_PLACEHOLDER</string>
      <key>LSMinimumSystemVersion</key>
      <string>10.15</string>
  </dict>
  </plist>
  EOF

  sed -i '' "s/VERSION_PLACEHOLDER/$VERSION/" "dist/$APP_NAME.app/Contents/Info.plist"

  # Create postinstall script
  mkdir -p scripts
  cat > scripts/postinstall << 'EOF'
  #!/bin/bash

  # Install launchd plist
  cp "/Applications/Alga Remote Agent.app/Contents/Resources/com.algapsa.remote-agent.plist" \
     "/Library/LaunchDaemons/"

  # Load service
  launchctl load "/Library/LaunchDaemons/com.algapsa.remote-agent.plist"

  exit 0
  EOF

  chmod +x scripts/postinstall

  # Build component package
  pkgbuild \
      --root dist \
      --identifier "$IDENTIFIER" \
      --version "$VERSION" \
      --install-location /Applications \
      --scripts scripts \
      component.pkg

  # Create distribution XML
  cat > distribution.xml << 'EOF'
  <?xml version="1.0" encoding="utf-8"?>
  <installer-gui-script minSpecVersion="1.000000">
      <title>Alga Remote Agent</title>
      <options customize="never" require-scripts="false" hostArchitectures="x86_64,arm64"/>
      <domains enable_anywhere="false" enable_currentUserHome="false" enable_localSystem="true"/>
      <choices-outline>
          <line choice="default"/>
      </choices-outline>
      <choice id="default" title="Alga Remote Agent">
          <pkg-ref id="com.algapsa.remote-agent"/>
      </choice>
      <pkg-ref id="com.algapsa.remote-agent" version="VERSION_PLACEHOLDER" onConclusion="none">component.pkg</pkg-ref>
  </installer-gui-script>
  EOF

  sed -i '' "s/VERSION_PLACEHOLDER/$VERSION/" distribution.xml

  # Build product archive
  productbuild \
      --distribution distribution.xml \
      --package-path . \
      --sign "Developer ID Installer: Your Name" \
      "AlgaRemoteAgent-$VERSION.pkg"

  echo "Package created: AlgaRemoteAgent-$VERSION.pkg"
  ```

- [ ] **Test installer**
  - Install on clean macOS VM
  - Verify app bundle structure
  - Verify launchd service starts
  - Verify permissions prompts appear
  - Verify enrollment works

**Success Criteria**:
- PKG installs successfully
- Universal binary supports Intel and Apple Silicon
- Service starts automatically
- Uninstaller works correctly

---

# Week 8: Testing & Polish

## Goals

- Comprehensive integration testing
- Performance optimization
- Bug fixes and polish
- Documentation updates
- Prepare for Phase 3

---

## 8.1 Integration Testing

### 8.1.1 Test Infrastructure

**Objective**: Set up automated testing for remote desktop features

#### Tasks

- [ ] **Create test harness for agent**

  **File**: `/ee/agent/tests/integration_test.rs` (new)

  ```rust
  #[tokio::test]
  async fn test_keyboard_input_injection() {
      let injector = create_input_injector().unwrap();

      // Test basic key
      injector.inject_key_event(KeyEvent {
          code: "KeyA".to_string(),
          pressed: true,
          modifiers: Default::default(),
      }).unwrap();

      injector.inject_key_event(KeyEvent {
          code: "KeyA".to_string(),
          pressed: false,
          modifiers: Default::default(),
      }).unwrap();

      // Test modifier combination
      injector.inject_key_event(KeyEvent {
          code: "KeyC".to_string(),
          pressed: true,
          modifiers: KeyModifiers {
              ctrl: true,
              ..Default::default()
          },
      }).unwrap();
  }

  #[tokio::test]
  async fn test_pty_terminal() {
      let (output_tx, mut output_rx) = mpsc::channel(100);
      let (shutdown_tx, shutdown_rx) = mpsc::channel(1);

      let mut pty = PtyTerminal::new(80, 24).unwrap();

      // Start read loop
      tokio::spawn(async move {
          pty.read_loop(output_tx, shutdown_rx).await.unwrap();
      });

      // Send command
      pty.write(b"echo hello\n").unwrap();

      // Wait for output
      let output = tokio::time::timeout(
          Duration::from_secs(2),
          output_rx.recv()
      ).await.unwrap().unwrap();

      let output_str = String::from_utf8_lossy(&output);
      assert!(output_str.contains("hello"));
  }
  ```

- [ ] **Create end-to-end test suite**

  **File**: `/ee/server/tests/remote/e2e.test.ts` (new)

  ```typescript
  import { test, expect } from '@playwright/test';

  test.describe('Remote Desktop', () => {
      test('full session workflow', async ({ page, context }) => {
          // Login as engineer
          await page.goto('/login');
          await page.fill('[name=email]', 'engineer@test.com');
          await page.fill('[name=password]', 'password');
          await page.click('button[type=submit]');

          // Navigate to remote desktop
          await page.goto('/remote');

          // Select agent
          await page.click('[data-agent-id="test-agent-1"]');

          // Request session
          await page.click('button:has-text("Connect")');

          // Wait for connection
          await expect(page.locator('.connection-status')).toHaveText('Connected', {
              timeout: 10000,
          });

          // Verify video stream
          const video = page.locator('video');
          await expect(video).toBeVisible();

          // Open terminal
          await page.click('button:has-text("Terminal")');
          await expect(page.locator('.xterm')).toBeVisible();

          // Send command in terminal
          await page.locator('.xterm').focus();
          await page.keyboard.type('echo test\n');

          // Verify output (simplified - actual implementation needs more robust checking)
          await expect(page.locator('.xterm')).toContainText('test');

          // End session
          await page.click('button:has-text("End Session")');
          await expect(page.locator('.connection-status')).toHaveText('Disconnected');
      });
  });
  ```

- [ ] **Test NAT traversal scenarios**
  - Direct connection (same network)
  - NAT with port forwarding
  - Symmetric NAT (requires TURN)
  - Firewall blocking UDP (TCP fallback)

- [ ] **Test cross-platform scenarios**
  - Windows agent + browser client
  - macOS agent + browser client
  - Mixed platform environments

**Success Criteria**:
- All integration tests pass
- E2E tests cover major workflows
- NAT traversal works in all scenarios
- Cross-platform compatibility verified

---

## 8.2 Performance Optimization

### 8.2.1 Video Encoding Optimization

#### Tasks

- [ ] **Implement hardware acceleration detection**

  **File**: `/ee/agent/src/encoding/mod.rs` (new)

  ```rust
  pub enum EncoderType {
      Hardware,
      Software,
  }

  pub fn detect_hardware_encoder() -> EncoderType {
      #[cfg(target_os = "windows")]
      {
          // Check for Intel Quick Sync, NVIDIA NVENC, AMD VCE
          if check_quicksync_available() {
              return EncoderType::Hardware;
          }
      }

      #[cfg(target_os = "macos")]
      {
          // VideoToolbox is usually available
          return EncoderType::Hardware;
      }

      EncoderType::Software
  }
  ```

- [ ] **Implement adaptive bitrate**
  - Monitor network conditions
  - Adjust encoding quality based on bandwidth
  - Implement quality presets (low, medium, high)

  ```rust
  pub struct AdaptiveBitrateController {
      current_bitrate: u32,
      target_bitrate: u32,
      quality: Quality,
  }

  impl AdaptiveBitrateController {
      pub fn adjust_based_on_rtt(&mut self, rtt_ms: u32) {
          if rtt_ms > 200 {
              // High latency - reduce bitrate
              self.target_bitrate = (self.target_bitrate as f32 * 0.8) as u32;
          } else if rtt_ms < 50 {
              // Low latency - can increase bitrate
              self.target_bitrate = (self.target_bitrate as f32 * 1.1) as u32;
          }

          // Clamp to reasonable range
          self.target_bitrate = self.target_bitrate.clamp(500_000, 5_000_000);
      }
  }
  ```

- [ ] **Optimize frame capture**
  - Skip frames when no changes detected
  - Capture at variable frame rate based on activity
  - Implement damage tracking (only encode changed regions)

**Success Criteria**:
- Video encoding uses <20% CPU on modern hardware
- Adaptive bitrate responds to network conditions
- Frame rate stays above 25fps during normal use

---

## 8.3 Bug Fixes & Polish

### 8.3.1 Known Issues

#### Tasks

- [ ] **Fix keyboard issues**
  - Stuck modifier keys
  - Key repeat issues
  - Special key combinations not working

- [ ] **Fix mouse issues**
  - Cursor position drift
  - Scroll wheel direction
  - Right-click context menu

- [ ] **Fix terminal issues**
  - Terminal resize lag
  - Encoding issues with special characters
  - Clipboard paste formatting

- [ ] **Improve error handling**
  - Better error messages
  - Graceful degradation
  - Automatic reconnection

- [ ] **Add logging and diagnostics**
  - Connection quality metrics
  - Performance metrics
  - Debug logs for troubleshooting

**Success Criteria**:
- No known critical bugs
- Error messages are user-friendly
- Logging provides useful debugging information

---

## 8.4 Documentation

### 8.4.1 Technical Documentation

#### Tasks

- [ ] **Document API endpoints**
  - Update OpenAPI spec
  - Add request/response examples
  - Document error codes

  **File**: `/ee/docs/api/remote-desktop.md` (new)

- [ ] **Document agent configuration**
  - Configuration file format
  - Environment variables
  - Command-line arguments

  **File**: `/ee/docs/agent/configuration.md` (new)

- [ ] **Document deployment**
  - TURN server setup
  - Agent deployment (GPO, MDM)
  - Troubleshooting guide

  **File**: `/ee/docs/deployment/remote-desktop.md` (new)

- [ ] **Create architecture diagrams**
  - System architecture
  - Data flow diagrams
  - Sequence diagrams for key workflows

**Success Criteria**:
- All public APIs documented
- Deployment guide complete
- Troubleshooting guide covers common issues

---

# Cross-Cutting Concerns

## Logging & Monitoring

### Agent Logging

**File**: `/ee/agent/src/logging.rs` (new)

```rust
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt, EnvFilter};

pub fn init_logging() {
    tracing_subscriber::registry()
        .with(EnvFilter::from_default_env())
        .with(tracing_subscriber::fmt::layer())
        .init();
}

// Structured logging for key events
pub fn log_session_event(event: &str, session_id: &str, details: &serde_json::Value) {
    tracing::info!(
        session_id = %session_id,
        event = %event,
        details = %details,
        "Session event"
    );
}
```

### Server Monitoring

**File**: `/ee/server/src/lib/remote/metrics.ts` (new)

```typescript
import { Counter, Histogram, Gauge } from 'prom-client';

export const remoteSessions = new Gauge({
  name: 'remote_sessions_active',
  help: 'Number of active remote sessions',
});

export const sessionDuration = new Histogram({
  name: 'remote_session_duration_seconds',
  help: 'Remote session duration in seconds',
  buckets: [60, 300, 600, 1800, 3600, 7200],
});

export const turnRelayRate = new Gauge({
  name: 'remote_turn_relay_rate',
  help: 'Percentage of connections using TURN relay',
});

export const inputLatency = new Histogram({
  name: 'remote_input_latency_ms',
  help: 'Input latency in milliseconds',
  buckets: [10, 25, 50, 100, 200, 500],
});
```

---

## Security Considerations

### Input Validation

- All WebSocket messages must be validated
- Data channel messages must be authenticated
- Session tokens must be checked on every operation

### Rate Limiting

**File**: `/ee/server/src/lib/remote/rate-limit.ts` (new)

```typescript
const sessionRequestLimiter = new RateLimiter({
  points: 10, // 10 requests
  duration: 60, // per minute
});

export async function checkSessionRequestRateLimit(userId: string): Promise<boolean> {
  try {
    await sessionRequestLimiter.consume(userId);
    return true;
  } catch (e) {
    return false;
  }
}
```

### Audit Logging

- Log all session requests and approvals
- Log all permission changes
- Log all connection attempts (success and failure)
- Log all data channel operations

---

# Testing Strategy

## Unit Tests

- [ ] Input injection (Windows and macOS)
- [ ] PTY terminal module
- [ ] Keyboard/mouse event parsing
- [ ] Permission checks
- [ ] Enrollment code generation and validation

## Integration Tests

- [ ] Agent enrollment flow
- [ ] WebRTC connection establishment
- [ ] Data channel communication
- [ ] Video stream transmission
- [ ] Terminal I/O

## End-to-End Tests

- [ ] Full session workflow (connect, control, disconnect)
- [ ] Terminal access
- [ ] Multi-platform scenarios
- [ ] NAT traversal scenarios
- [ ] Permission enforcement

## Performance Tests

- [ ] Video encoding performance
- [ ] Input latency
- [ ] Network bandwidth usage
- [ ] Concurrent session handling

## Security Tests

- [ ] Authentication bypass attempts
- [ ] Permission escalation attempts
- [ ] Session hijacking attempts
- [ ] Input injection attacks

---

# Success Criteria

## Week 5 Success Criteria

- ✅ All keyboard keys can be sent and injected
- ✅ Special key combinations work (Ctrl+Alt+Del, etc.)
- ✅ Mouse scroll wheel works
- ✅ TURN server deployed and operational
- ✅ Enrollment codes can be generated
- ✅ Agents can enroll using codes
- ✅ Basic permissions model implemented

## Week 6 Success Criteria

- ✅ PTY terminal works on Windows
- ✅ Terminal I/O flows over data channel
- ✅ xterm.js displays terminal correctly
- ✅ Terminal resize works
- ✅ Copy/paste works in terminal
- ✅ Terminal scrollback works

## Week 7 Success Criteria

- ✅ macOS agent compiles and runs
- ✅ Screen capture works on macOS
- ✅ Input injection works on macOS
- ✅ macOS permissions are handled correctly
- ✅ LaunchDaemon service works
- ✅ PKG installer installs correctly

## Week 8 Success Criteria

- ✅ All integration tests pass
- ✅ E2E tests cover main workflows
- ✅ Performance targets met
- ✅ No critical bugs
- ✅ Documentation complete
- ✅ Ready for Phase 3

## Overall Phase 2 Success Criteria

- ✅ Full keyboard and mouse control works
- ✅ Terminal access functional
- ✅ Both Windows and macOS agents operational
- ✅ TURN server handles NAT traversal
- ✅ Enrollment system works
- ✅ Basic permissions enforced
- ✅ Tests provide good coverage
- ✅ Documentation enables Phase 3 work

---

# Risk Management

## Technical Risks

| Risk | Mitigation |
|------|------------|
| PTY compatibility issues on Windows | Test on multiple Windows versions; use portable-pty abstractions |
| macOS permissions are confusing to users | Create clear UI/documentation; provide guided setup |
| Keyboard mapping differences across platforms | Comprehensive key mapping tables; testing on real hardware |
| TURN server costs | Monitor relay usage; optimize for direct connections first |
| Performance issues with video encoding | Implement adaptive quality; use hardware acceleration |

## Schedule Risks

| Risk | Mitigation |
|------|------------|
| macOS development takes longer than expected | Start macOS work early in week; have Windows fallback |
| Testing uncovers major issues | Allocate full Week 8 for testing and fixes |
| Dependencies have breaking changes | Pin dependency versions; test updates in isolation |

## Resource Risks

| Risk | Mitigation |
|------|------------|
| Need macOS hardware for testing | Use cloud Mac instances or CI/CD with macOS runners |
| TURN server infrastructure costs | Start with small deployment; scale based on usage |

---

# Phase 2 to Phase 3 Handoff

## Deliverables for Phase 3

Phase 3 will need:
- ✅ Stable keyboard/mouse/terminal implementation
- ✅ Working macOS and Windows agents
- ✅ TURN server operational
- ✅ Enrollment system in place
- ✅ Permission model defined

## Known Limitations (to be addressed in Phase 3)

- UAC prompts not yet accessible (needs Windows system service)
- Unattended access not yet supported
- File transfer not yet implemented
- Multi-monitor support basic
- Session recording not implemented

## Recommended Phase 3 Priorities

1. Windows system service for UAC handling
2. File transfer over data channel
3. Enhanced permission model with role-based access
4. Session recording (for compliance)
5. Multi-monitor improvements

---

# Appendix

## A. Key Dependencies

```toml
# Agent (Rust)
webrtc = "0.11"
portable-pty = "0.8"
tokio = "1"
scrap = "0.5"

[target.'cfg(windows)'.dependencies]
windows = "0.52"

[target.'cfg(target_os = "macos")'.dependencies]
core-graphics = "0.23"
cocoa = "0.25"
```

```json
// Browser Client (npm)
{
  "dependencies": {
    "xterm": "^5.3.0",
    "xterm-addon-fit": "^0.8.0",
    "xterm-addon-web-links": "^0.9.0"
  }
}
```

## B. Reference Links

- [WebRTC Specification](https://www.w3.org/TR/webrtc/)
- [coturn Documentation](https://github.com/coturn/coturn/wiki)
- [portable-pty Crate](https://docs.rs/portable-pty/)
- [xterm.js Documentation](https://xtermjs.org/)
- [Windows Virtual Key Codes](https://docs.microsoft.com/en-us/windows/win32/inputdev/virtual-key-codes)
- [macOS Key Codes](https://developer.apple.com/documentation/appkit/nsevent/specialkey)

## C. Glossary

- **ConPTY**: Windows Console Pseudo-Terminal
- **PTY**: Pseudo-Terminal
- **TURN**: Traversal Using Relays around NAT
- **STUN**: Session Traversal Utilities for NAT
- **SDP**: Session Description Protocol
- **ICE**: Interactive Connectivity Establishment
- **Data Channel**: WebRTC mechanism for arbitrary data transfer
- **launchd**: macOS service management framework

---

**End of Phase 2 Implementation Plan**
