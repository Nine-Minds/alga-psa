/**
 * Remote Desktop Domain Types
 * Types for WebRTC-based remote desktop support functionality
 */

// Agent types
export type AgentStatus = 'online' | 'offline' | 'suspended';
export type OSType = 'windows' | 'macos';

export interface IRemoteAgent {
  tenant: string;
  agent_id: string;
  agent_name: string;
  hostname: string;
  os_type: OSType;
  os_version?: string;
  company_id?: string;
  agent_version: string;
  status: AgentStatus;
  last_seen_at?: Date;
  registered_at: Date;
  metadata: {
    ip_address?: string;
    cpu?: string;
    memory_gb?: number;
    [key: string]: unknown;
  };
  connection_token?: string;
  created_at: Date;
  updated_at: Date;
}

// Session types
export type SessionStatus = 'pending' | 'active' | 'ended' | 'denied' | 'failed';
export type SessionEndReason =
  | 'user_disconnect'
  | 'timeout'
  | 'error'
  | 'agent_offline'
  | 'user_denied';

export interface IRemoteSession {
  tenant: string;
  session_id: string;
  agent_id: string;
  engineer_user_id: string;
  status: SessionStatus;
  requested_at: Date;
  started_at?: Date;
  ended_at?: Date;
  end_reason?: SessionEndReason;
  connection_metadata: {
    ice_candidates?: unknown[];
    connection_quality?: string;
    [key: string]: unknown;
  };
  duration_seconds?: number;
  created_at: Date;
  updated_at: Date;
}

// Session event types
export type SessionEventType =
  | 'session_requested'
  | 'session_accepted'
  | 'session_denied'
  | 'connection_established'
  | 'connection_lost'
  | 'input_started'
  | 'input_stopped'
  | 'screenshot_taken'
  | 'session_ended';

export interface ISessionEvent {
  tenant: string;
  event_id: string;
  session_id: string;
  event_type: SessionEventType;
  event_data: Record<string, unknown>;
  timestamp: Date;
}

// WebSocket signaling message types
export type SignalingMessageType =
  | 'offer'
  | 'answer'
  | 'ice-candidate'
  | 'session-request'
  | 'session-accept'
  | 'session-deny'
  | 'connected'
  | 'error';

export interface SignalingMessage {
  type: SignalingMessageType;
  sessionId?: string;
  senderId?: string;
  payload?: unknown;
  timestamp?: number;
  message?: string;
  role?: 'agent' | 'engineer';
  userId?: string;
  engineerId?: string;
}

export interface SDPMessage {
  type: 'offer' | 'answer';
  sdp: string;
}

export interface ICECandidateMessage {
  candidate: string;
  sdpMid: string | null;
  sdpMLineIndex: number | null;
}

// API request/response types
export interface CreateAgentRequest {
  agent_name: string;
  hostname: string;
  os_type: OSType;
  os_version?: string;
  company_id?: string;
  agent_version: string;
  metadata?: Record<string, unknown>;
}

export interface UpdateAgentRequest {
  agent_name?: string;
  os_version?: string;
  company_id?: string;
  agent_version?: string;
  status?: AgentStatus;
  metadata?: Record<string, unknown>;
}

export interface CreateSessionRequest {
  agent_id: string;
}

export interface CreateSessionResponse {
  session_id: string;
  status: SessionStatus;
  agent_info: {
    agent_id: string;
    agent_name: string;
    hostname: string;
    os_type: OSType;
  };
}

export interface SessionDetailsResponse extends IRemoteSession {
  agent: IRemoteAgent;
  events: ISessionEvent[];
}

export interface AgentListResponse {
  success: boolean;
  data: IRemoteAgent[];
}

export interface SessionListResponse {
  success: boolean;
  data: IRemoteSession[];
}

// Input event types (for browser -> agent communication)
export type InputEventType =
  | 'MouseMove'
  | 'MouseDown'
  | 'MouseUp'
  | 'MouseScroll'
  | 'KeyDown'
  | 'KeyUp'
  | 'SpecialKeyCombo';

export interface MouseMoveEvent {
  type: 'MouseMove';
  x: number;
  y: number;
}

export type MouseButton = 'left' | 'right' | 'middle' | 'back' | 'forward';

export interface MouseButtonEvent {
  type: 'MouseDown' | 'MouseUp';
  button: MouseButton;
  x?: number;
  y?: number;
}

export interface MouseScrollEvent {
  type: 'MouseScroll';
  delta_x: number;
  delta_y: number;
  deltaMode?: number; // 0 = pixels, 1 = lines, 2 = pages
}

// Enhanced keyboard event with full modifier and location support
export interface KeyModifiers {
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  meta: boolean; // Windows/Cmd key
}

export type KeyLocation = 0 | 1 | 2 | 3; // 0=standard, 1=left, 2=right, 3=numpad

export interface KeyEvent {
  type: 'KeyDown' | 'KeyUp';
  key: string;           // e.g., "a", "Enter", "F1"
  code: string;          // e.g., "KeyA", "Enter", "F1"
  modifiers: KeyModifiers;
  location: KeyLocation;
}

// Special key combinations that can't be captured from browser
export type SpecialKeyCombo =
  | 'ctrl-alt-del'
  | 'win-l'           // Lock screen
  | 'win-r'           // Run dialog
  | 'alt-tab'
  | 'ctrl-shift-esc'  // Task Manager
  | 'print-screen';

export interface SpecialKeyComboEvent {
  type: 'SpecialKeyCombo';
  combo: SpecialKeyCombo;
}

export type InputEvent =
  | MouseMoveEvent
  | MouseButtonEvent
  | MouseScrollEvent
  | KeyEvent
  | SpecialKeyComboEvent;

// WebSocket authenticated connection types
export interface AuthenticatedWSConnection {
  userId: string;
  tenant: string;
  role: 'agent' | 'engineer';
  agentId?: string;
  sessionId?: string;
  isAlive: boolean;
}

// Terminal/PTY message types (for browser <-> agent communication)
export type TerminalMessageType =
  | 'pty-start'
  | 'pty-input'
  | 'pty-output'
  | 'pty-resize'
  | 'pty-close'
  | 'pty-error'
  | 'pty-closed';

export interface PtyStartMessage {
  type: 'pty-start';
  cols: number;
  rows: number;
  shell?: string; // Optional shell override
}

export interface PtyInputMessage {
  type: 'pty-input';
  data: number[]; // Byte array
}

export interface PtyOutputMessage {
  type: 'pty-output';
  data: number[]; // Byte array
}

export interface PtyResizeMessage {
  type: 'pty-resize';
  cols: number;
  rows: number;
}

export interface PtyCloseMessage {
  type: 'pty-close';
}

export interface PtyErrorMessage {
  type: 'pty-error';
  message: string;
  code?: string;
}

export interface PtyClosedMessage {
  type: 'pty-closed';
  exitCode?: number;
}

export type TerminalMessage =
  | PtyStartMessage
  | PtyInputMessage
  | PtyOutputMessage
  | PtyResizeMessage
  | PtyCloseMessage
  | PtyErrorMessage
  | PtyClosedMessage;

// Enrollment code types
export interface IEnrollmentCode {
  tenant: string;
  code_id: string;
  company_id?: string;
  code?: string; // Only returned on creation
  code_hash: string;
  created_by: string;
  created_at: Date;
  expires_at: Date;
  usage_limit: number;
  usage_count: number;
  default_permissions: RemoteAccessPermission;
  revoked_at?: Date;
  revoked_by?: string;
}

export interface CreateEnrollmentCodeRequest {
  company_id?: string;
  expires_in_hours?: number;
  usage_limit?: number;
  permissions?: Partial<RemoteAccessPermission>;
}

export interface CreateEnrollmentCodeResponse {
  code_id: string;
  code: string; // Only returned once!
  expires_at: Date;
  usage_limit: number;
  permissions: RemoteAccessPermission;
}

export interface EnrollAgentRequest {
  enrollment_code: string;
  machine_id: string;
  hostname: string;
  os_type: OSType;
  os_version?: string;
  agent_version: string;
}

export interface EnrollAgentResponse {
  agent_id: string;
  tenant_id: string;
  connection_token?: string; // Only on new enrollment
  signaling_server: string;
  permissions: RemoteAccessPermission;
  already_enrolled?: boolean;
}

// Permission types
export interface RemoteAccessPermission {
  canConnect: boolean;
  canViewScreen: boolean;
  canControlInput: boolean;
  canAccessTerminal: boolean;
  canTransferFiles: boolean;
  canElevate: boolean;
  requiresUserConsent: boolean;
  sessionDurationLimit?: number;
}
