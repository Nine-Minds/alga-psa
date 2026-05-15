export type InboundWebhookAuthType = 'hmac_sha256' | 'bearer' | 'ip_allowlist' | 'path_token';
export type InboundWebhookHandlerType = 'direct_action' | 'workflow';

export interface HmacSha256AuthConfig {
  type: 'hmac_sha256';
  signatureHeader: string;
  secretVaultPath: string;
}

export interface BearerAuthConfig {
  type: 'bearer';
  tokenVaultPath: string;
}

export interface IpAllowlistAuthConfig {
  type: 'ip_allowlist';
  ipCidrs: string[];
}

export interface PathTokenAuthConfig {
  type: 'path_token';
  queryParam: string;
  tokenVaultPath: string;
}

export type InboundWebhookAuthConfig =
  | HmacSha256AuthConfig
  | BearerAuthConfig
  | IpAllowlistAuthConfig
  | PathTokenAuthConfig;

export interface HeaderIdempotencySource {
  type: 'header';
  value: string;
}

export interface JsonataIdempotencySource {
  type: 'jsonata';
  value: string;
}

export type InboundWebhookIdempotencySource = HeaderIdempotencySource | JsonataIdempotencySource;

export interface DirectActionHandlerConfig {
  type: 'direct_action';
  action: string;
  fieldMapping: Record<string, string>;
}

export interface WorkflowHandlerConfig {
  type: 'workflow';
  workflowId: string;
}

export type InboundWebhookHandlerConfig = DirectActionHandlerConfig | WorkflowHandlerConfig;

export interface InboundWebhookConfig {
  tenant: string;
  inboundWebhookId: string;
  name: string;
  slug: string;
  description: string | null;
  authType: InboundWebhookAuthType;
  authConfig: InboundWebhookAuthConfig;
  idempotencySource: InboundWebhookIdempotencySource | null;
  idempotencyWindowSeconds: number;
  handlerType: InboundWebhookHandlerType;
  handlerConfig: InboundWebhookHandlerConfig;
  samplePayload: unknown | null;
  sampleCaptureExpiresAt: string | Date | null;
  isActive: boolean;
  rateLimitPerMinute: number;
  autoDisabledAt: string | Date | null;
  createdBy: string | null;
  createdAt: string | Date;
  updatedAt: string | Date;
}

export type InboundWebhookAuthStatus =
  | 'verified'
  | 'rejected_signature'
  | 'rejected_bearer'
  | 'rejected_ip'
  | 'rejected_no_auth';

export type InboundWebhookDispatchStatus = 'pending' | 'dispatched' | 'duplicate' | 'failed';

export interface InboundWebhookDelivery {
  tenant: string;
  deliveryId: string;
  inboundWebhookId: string | null;
  idempotencyKey: string | null;
  receivedAt: string | Date;
  requestMethod: string;
  requestPath: string;
  requestHeaders: Record<string, string | string[]>;
  requestBody: unknown | null;
  sourceIp: string | null;
  userAgent: string | null;
  authStatus: InboundWebhookAuthStatus;
  dispatchStatus: InboundWebhookDispatchStatus;
  handlerOutcome: Record<string, unknown> | null;
  responseStatus: number | null;
  responseBody: unknown | null;
  durationMs: number | null;
  retryCount: number;
  isReplay: boolean;
  replayedFrom: string | null;
  createdAt: string | Date;
  updatedAt: string | Date;
}

export interface WorkflowWebhookEnvelope {
  source: string;
  body: unknown;
  headers: Record<string, string | string[]>;
  verified: true;
  delivery_id: string;
  idempotency_key: string | null;
  received_at: string;
}
