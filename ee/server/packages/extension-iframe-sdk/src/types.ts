/**
 * Versioned, authenticated message envelope shared by parent and child.
 * All messages must include this envelope, and version MUST be "1".
 */

export type EnvelopeVersion = '1';

export interface Envelope<TType extends string = string, TPayload = unknown> {
  alga: true;
  version: EnvelopeVersion;
  type: TType;
  request_id?: string;
  payload: TPayload;
}

/**
 * Host (parent) -> Client (iframe) messages
 */
export interface BootstrapPayload {
  session: { token: string; expires_at: string };
  theme_tokens: Record<string, string>;
  navigation: { path: string };
}
export type HostToClientType = 'bootstrap';
export type HostToClientMessage =
  | Envelope<'bootstrap', BootstrapPayload>;

/**
 * Client (iframe) -> Host (parent) messages
 */
export interface ResizePayload { height: number }
export interface NavigatePayload { path: string }
export type ClientToHostType = 'ready' | 'resize' | 'navigate';
export type ClientToHostMessage =
  | Envelope<'ready', {}>
  | Envelope<'resize', ResizePayload>
  | Envelope<'navigate', NavigatePayload>;

/**
 * Union helpers
 */
export type AnyMessage = HostToClientMessage | ClientToHostMessage;

/**
 * Utilities for runtime type guards
 */
export function isEnvelope(value: unknown): value is Envelope {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return v.alga === true && v.version === '1' && typeof v.type === 'string' && typeof v.payload !== 'undefined';
}

export function isHostToClient(msg: Envelope): msg is HostToClientMessage {
  return msg.type === 'bootstrap';
}

export function isClientToHost(msg: Envelope): msg is ClientToHostMessage {
  return msg.type === 'ready' || msg.type === 'resize' || msg.type === 'navigate';
}

