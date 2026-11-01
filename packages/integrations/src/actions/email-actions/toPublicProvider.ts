/**
 * Secret-free projection of email providers for anything that leaves the server.
 *
 * Every config is built field by field (an allowlist). A column added to the
 * internal config types later does NOT reach the browser unless it is added here
 * deliberately; secrets are surfaced only as `has_*` booleans.
 */

import type {
  EmailProvider,
  GoogleEmailProviderConfig,
  ImapEmailProviderConfig,
  MicrosoftEmailProviderConfig,
  PublicEmailProvider,
  PublicGoogleConfig,
  PublicImapConfig,
  PublicMicrosoftConfig,
} from '../../components/email/types';

const present = (value: unknown): boolean =>
  typeof value === 'string' ? value.length > 0 : value !== null && value !== undefined;

export function toPublicMicrosoftConfig(c: MicrosoftEmailProviderConfig): PublicMicrosoftConfig {
  return {
    email_provider_id: c.email_provider_id,
    tenant: c.tenant,
    client_id: c.client_id,
    microsoft_profile_id: c.microsoft_profile_id,
    client_secret_ref: c.client_secret_ref,
    tenant_id: c.tenant_id,
    redirect_uri: c.redirect_uri,
    auto_process_emails: c.auto_process_emails,
    max_emails_per_sync: c.max_emails_per_sync,
    folder_filters: c.folder_filters,
    token_expires_at: c.token_expires_at,
    webhook_subscription_id: c.webhook_subscription_id,
    webhook_expires_at: c.webhook_expires_at,
    last_subscription_renewal: c.last_subscription_renewal,
    delivery_mode: c.delivery_mode,
    last_webhook_delivery_at: c.last_webhook_delivery_at,
    webhook_silent_runs: c.webhook_silent_runs,
    next_subscription_probe_at: c.next_subscription_probe_at,
    created_at: c.created_at,
    updated_at: c.updated_at,
    has_client_secret: present(c.client_secret),
    has_access_token: present(c.access_token),
    has_refresh_token: present(c.refresh_token),
    has_webhook_verification_token: present(c.webhook_verification_token),
  };
}

export function toPublicGoogleConfig(c: GoogleEmailProviderConfig): PublicGoogleConfig {
  return {
    email_provider_id: c.email_provider_id,
    tenant: c.tenant,
    client_id: c.client_id,
    project_id: c.project_id,
    redirect_uri: c.redirect_uri,
    auto_process_emails: c.auto_process_emails,
    max_emails_per_sync: c.max_emails_per_sync,
    label_filters: c.label_filters,
    token_expires_at: c.token_expires_at,
    history_id: c.history_id,
    watch_expiration: c.watch_expiration,
    last_push_received_at: c.last_push_received_at,
    pubsub_initialised_at: c.pubsub_initialised_at,
    pubsub_topic_name: c.pubsub_topic_name,
    pubsub_subscription_name: c.pubsub_subscription_name,
    created_at: c.created_at,
    updated_at: c.updated_at,
    has_client_secret: present(c.client_secret),
    has_access_token: present(c.access_token),
    has_refresh_token: present(c.refresh_token),
  };
}

export function toPublicImapConfig(c: ImapEmailProviderConfig): PublicImapConfig {
  return {
    email_provider_id: c.email_provider_id,
    tenant: c.tenant,
    host: c.host,
    port: c.port,
    secure: c.secure,
    allow_starttls: c.allow_starttls,
    auth_type: c.auth_type,
    username: c.username,
    folder_filters: c.folder_filters,
    auto_process_emails: c.auto_process_emails,
    max_emails_per_sync: c.max_emails_per_sync,
    oauth_authorize_url: c.oauth_authorize_url,
    oauth_token_url: c.oauth_token_url,
    oauth_client_id: c.oauth_client_id,
    oauth_scopes: c.oauth_scopes,
    token_expires_at: c.token_expires_at,
    uid_validity: c.uid_validity,
    last_uid: c.last_uid,
    folder_state: c.folder_state,
    last_processed_message_id: c.last_processed_message_id,
    server_capabilities: c.server_capabilities,
    lease_owner: c.lease_owner,
    lease_expires_at: c.lease_expires_at,
    connection_timeout_ms: c.connection_timeout_ms,
    socket_keepalive: c.socket_keepalive,
    last_seen_at: c.last_seen_at,
    last_sync_at: c.last_sync_at,
    last_error: c.last_error,
    created_at: c.created_at,
    updated_at: c.updated_at,
    has_client_secret: present(c.oauth_client_secret),
    has_access_token: present(c.access_token),
    has_refresh_token: present(c.refresh_token),
  };
}

export function toPublicProvider(p: EmailProvider): PublicEmailProvider {
  return {
    id: p.id,
    tenant: p.tenant,
    providerType: p.providerType,
    providerName: p.providerName,
    senderDisplayName: p.senderDisplayName,
    mailbox: p.mailbox,
    isActive: p.isActive,
    inboundPausedAt: p.inboundPausedAt,
    inboundPauseReason: p.inboundPauseReason,
    inboundAuthFailureCount: p.inboundAuthFailureCount,
    inboundAuthFailureLastAt: p.inboundAuthFailureLastAt,
    inboundAuthFailureCode: p.inboundAuthFailureCode,
    status: p.status,
    lastSyncAt: p.lastSyncAt,
    errorMessage: p.errorMessage,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
    inboundTicketDefaultsId: p.inboundTicketDefaultsId,
    microsoftConfig: p.microsoftConfig ? toPublicMicrosoftConfig(p.microsoftConfig) : undefined,
    googleConfig: p.googleConfig ? toPublicGoogleConfig(p.googleConfig) : undefined,
    imapConfig: p.imapConfig ? toPublicImapConfig(p.imapConfig) : undefined,
  };
}
