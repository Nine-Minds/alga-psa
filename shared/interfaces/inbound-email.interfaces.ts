// Email provider interfaces for inbound email processing

export interface EmailProviderConfig {
  id: string;
  tenant: string;
  name: string;
  provider_type: 'microsoft' | 'google' | 'imap';
  mailbox: string;
  folder_to_monitor: string; // Defaults to 'Inbox'
  active: boolean;
  inboundPausedAt?: string | null;
  inboundPauseReason?: 'manual' | 'tenant_cancelled' | null;
  // Common webhook fields as real columns
  webhook_notification_url: string;
  webhook_subscription_id?: string;
  webhook_verification_token?: string;
  webhook_expires_at?: string; // ISO date
  last_subscription_renewal?: string; // ISO date
  delivery_mode?: 'webhook' | 'polling';
  last_webhook_delivery_at?: string;
  webhook_silent_runs?: number;
  next_subscription_probe_at?: string;
  // Connection status fields
  connection_status: 'connected' | 'disconnected' | 'error';
  last_connection_test?: string; // ISO date
  connection_error_message?: string;
  // Provider-specific configuration (OAuth scopes, etc.)
  provider_config?: {
    // Microsoft-specific
    tenantId?: string;
    scopes?: string[];
    // Google-specific (camelCase for interface compatibility)
    projectId?: string;
    pubsubTopic?: string;
    // Common OAuth settings
    clientId?: string; // Usually from environment, but could be per-provider
    
    // Database field names (snake_case) - for Gmail adapter compatibility
    project_id?: string;
    pubsub_topic_name?: string;
    pubsub_subscription_name?: string;
    client_id?: string;
    client_secret?: string;
    tenant_id?: string;
    microsoft_profile_id?: string;
    client_secret_ref?: string;
    resolved_client_id?: string;
    resolved_client_secret?: string;
    resolved_tenant_id?: string;
    resolved_credential_source?: 'profile' | 'vendor' | 'environment' | 'legacy';
    resolved_profile_id?: string;
    resolved_client_secret_ref?: string;
    access_token?: string;
    refresh_token?: string;
    token_expires_at?: string;
    history_id?: string;
    watch_expiration?: string;
    customScopes?: string[];
    // Gmail-specific processing configuration
    label_filters?: string[]; // names of labels to include (user-defined)
    auto_process_emails?: boolean;
    max_emails_per_sync?: number;

    // IMAP-specific configuration
    host?: string;
    port?: number;
    secure?: boolean;
    allow_starttls?: boolean;
    auth_type?: 'password' | 'oauth2';
    username?: string;
    password?: string;
    folder_filters?: string[];
    oauth_authorize_url?: string;
    oauth_token_url?: string;
    oauth_client_id?: string;
    oauth_client_secret?: string;
    oauth_scopes?: string;
    // Note: access_token, refresh_token, token_expires_at are defined above (shared with Gmail OAuth)
    uid_validity?: string;
    last_uid?: string;
    folder_state?: Record<string, { uid_validity?: string; last_uid?: string; last_seen_at?: string }>;
    last_processed_message_id?: string;
    server_capabilities?: string;
    lease_owner?: string;
    lease_expires_at?: string;
    connection_timeout_ms?: number;
    socket_keepalive?: boolean;
    last_seen_at?: string;
    last_sync_at?: string;
    last_error?: string;
  };
  created_at: string; // ISO date
  updated_at: string; // ISO date
}

export interface EmailIngressSkipReason {
  type: 'attachment' | 'raw_mime';
  reason:
    | 'attachment_over_max_bytes'
    | 'attachment_count_exceeded'
    | 'attachment_total_bytes_exceeded'
    | 'raw_mime_over_max_bytes';
  attachmentId?: string;
  attachmentName?: string;
  size: number;
  cap: number;
}

export interface EmailMessage {
  id: string;
  provider: 'microsoft' | 'google' | 'imap';
  providerId: string;
  tenant: string;
  receivedAt: string;
  from: {
    email: string;
    name?: string;
  };
  to: Array<{
    email: string;
    name?: string;
  }>;
  cc?: Array<{
    email: string;
    name?: string;
  }>;
  subject: string;
  body: {
    text: string;
    html?: string;
  };
  attachments?: Array<{
    id: string;
    name: string;
    contentType: string;
    size: number;
    contentId?: string;
    isInline?: boolean;
    content?: string;
  }>;
  threadId?: string;
  references?: string[];
  inReplyTo?: string;
  rawMime?: string;
  rawMimeBase64?: string;
  sourceMimeBase64?: string;
  rawSourceBase64?: string;
  ingressSkipReasons?: EmailIngressSkipReason[];
}

export interface EmailMessageDetails extends EmailMessage {
  // Additional details that might be available when fetching full message
  headers?: Record<string, string>;
  messageSize?: number;
  importance?: 'low' | 'normal' | 'high';
  sensitivity?: 'normal' | 'personal' | 'private' | 'confidential';
}

export interface InboundEmailEvent {
  event_type: 'INBOUND_EMAIL_RECEIVED';
  payload: {
    emailId: string;
    tenant: string;
    providerId: string;
    emailData: EmailMessage;
    matchedClient?: {
      clientId: string;
      clientName: string;
      contactId?: string;
      contactName?: string;
    };
  };
}

export interface EmailConnectionStatus {
  connected: boolean;
  status: 'connected' | 'disconnected' | 'error';
  clientName?: string;
  providerId?: string;
  errorMessage?: string;
  lastConnectionTest?: string;
}

export type UnifiedInboundEmailProvider = 'microsoft' | 'google' | 'imap';

export interface UnifiedInboundQueueJobBase {
  jobId: string;
  schemaVersion: 1;
  tenantId: string;
  providerId: string;
  provider: UnifiedInboundEmailProvider;
  enqueuedAt: string;
  attempt: number;
  maxAttempts: number;
}

export interface MicrosoftInboundEmailPointer {
  subscriptionId: string;
  messageId: string;
  resource?: string;
  changeType?: string;
}

export interface GoogleInboundEmailPointer {
  historyId: string;
  emailAddress: string;
  pubsubMessageId?: string;
  discoveredMessageIds?: string[];
}

export interface ImapInboundEmailPointer {
  mailbox: string;
  uid: string;
  uidValidity?: string;
  messageId?: string;
}

export type UnifiedInboundEmailQueueJob =
  | (UnifiedInboundQueueJobBase & {
      provider: 'microsoft';
      pointer: MicrosoftInboundEmailPointer;
    })
  | (UnifiedInboundQueueJobBase & {
      provider: 'google';
      pointer: GoogleInboundEmailPointer;
    })
  | (UnifiedInboundQueueJobBase & {
      provider: 'imap';
      pointer: ImapInboundEmailPointer;
    });

export interface EmailQueueJob {
  id: string;
  tenant: string;
  provider: 'microsoft' | 'google' | 'imap' | 'mailhog-test-provider';
  messageId: string;
  providerId: string;
  webhookData: any;
  attempt: number;
  maxRetries: number;
  createdAt: string;
  // Optional email data for cases where we already have the email content (e.g., MailHog)
  emailData?: EmailMessage;
}

// ===========================================================================
// Durable inbound email pipeline (V2 contracts)
// ===========================================================================

/**
 * Versioned work types carried by the V2 Redis transport. Payloads contain only
 * durable record IDs — never MIME or attachment content.
 */
export type DurableInboundEmailWorkType =
  | 'stage_ingress'
  | 'process_inbox'
  | 'process_artifact'
  | 'publish_outbox'
  | 'republish_outbox_event';

export interface UnifiedInboundEmailQueueJobV2 {
  schemaVersion: 2;
  workType: DurableInboundEmailWorkType;
  tenantId: string;
  /** Durable record id for the work type: ingress_id, inbox_id, artifact_key (per inbox), or outbox_id. */
  recordId: string;
  /** Secondary id used to disambiguate artifact/outbox rows scoped to an inbox. */
  inboxId?: string;
  jobId: string;
  enqueuedAt: string;
  attempt: number;
  maxAttempts: number;
}

/** Claim ownership record for a V2 queue job. */
export interface ClaimedInboundEmailQueueJobV2 {
  job: UnifiedInboundEmailQueueJobV2;
  originalPayload: string;
  claimToken: string;
  consumerId: string;
  claimedAt: string;
  leaseExpiresAt: string;
}

/** Dispositions a V2 consumer can return for a handled wake-up. */
export type InboundEmailQueueDisposition =
  | { disposition: 'ack'; outcome?: string; reason?: string }
  | { disposition: 'retry'; error: string }
  | { disposition: 'defer'; untilIso: string; reason?: string };

/** Structured durable-inbox terminal outcome stored on `inbound_email_inbox`. */
export type InboundEmailInboxOutcomeKind = 'created' | 'replied' | 'skipped' | 'reconciled';

export type InboundEmailDurableMode = 'off' | 'shadow' | 'enforce';

/**
 * Minimal shape of the durable inbox row as read by workers. Full row columns
 * are handled by the durable store; this captures the fields workers rely on.
 */
export interface InboundEmailInboxRecord {
  tenant: string;
  inbox_id: string;
  ingress_id: string | null;
  provider_id: string;
  provider_type: InboundProviderType;
  normalized_message_id: string;
  provider_message_id: string | null;
  rfc_message_id: string | null;
  source_object_key: string | null;
  source_sha256: string | null;
  source_size_bytes: string | number | null;
  source_staged_at: string | Date | null;
  envelope: Record<string, unknown>;
  legacy_imported: boolean;
  status: string;
  attempt_count: number;
  lease_owner: string | null;
  lease_token: string | null;
  lease_version: number;
  lease_expires_at: string | Date | null;
  next_attempt_at: string | Date | null;
  outcome_kind: InboundEmailInboxOutcomeKind | null;
  outcome_reason: string | null;
  ticket_id: string | null;
  comment_id: string | null;
  last_error: string | null;
  error_details: Record<string, unknown> | null;
  received_at: string | Date;
  completed_at: string | Date | null;
}

export type InboundProviderType = 'microsoft' | 'google' | 'imap';

