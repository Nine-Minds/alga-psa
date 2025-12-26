// Email provider interfaces for inbound email processing

export interface EmailProviderConfig {
  id: string;
  tenant: string;
  name: string;
  provider_type: 'microsoft' | 'google' | 'imap';
  mailbox: string;
  folder_to_monitor: string; // Defaults to 'Inbox'
  active: boolean;
  // Common webhook fields as real columns
  webhook_notification_url: string;
  webhook_subscription_id?: string;
  webhook_verification_token?: string;
  webhook_expires_at?: string; // ISO date
  last_subscription_renewal?: string; // ISO date
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
    access_token?: string;
    refresh_token?: string;
    token_expires_at?: string;
    uid_validity?: string;
    last_uid?: string;
    folder_state?: Record<string, { uid_validity?: string; last_uid?: string; last_seen_at?: string }>;
    last_seen_at?: string;
    last_sync_at?: string;
    last_error?: string;
  };
  created_at: string; // ISO date
  updated_at: string; // ISO date
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
  }>;
  threadId?: string;
  references?: string[];
  inReplyTo?: string;
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
