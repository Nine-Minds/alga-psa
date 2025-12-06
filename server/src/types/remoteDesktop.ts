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
  | 'KeyUp';

export interface MouseMoveEvent {
  type: 'MouseMove';
  x: number;
  y: number;
}

export interface MouseButtonEvent {
  type: 'MouseDown' | 'MouseUp';
  button: 'left' | 'right' | 'middle';
}

export interface MouseScrollEvent {
  type: 'MouseScroll';
  delta_x: number;
  delta_y: number;
}

export interface KeyEvent {
  type: 'KeyDown' | 'KeyUp';
  key: string;
}

export type InputEvent =
  | MouseMoveEvent
  | MouseButtonEvent
  | MouseScrollEvent
  | KeyEvent;

// WebSocket authenticated connection types
export interface AuthenticatedWSConnection {
  userId: string;
  tenant: string;
  role: 'agent' | 'engineer';
  agentId?: string;
  sessionId?: string;
  isAlive: boolean;
}
