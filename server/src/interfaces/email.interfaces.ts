// Email provider interfaces for inbound email processing

export interface EmailProviderConfig {
  id: string;
  tenant: string;
  name: string;
  provider_type: 'microsoft' | 'google';
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
    // Google-specific
    projectId?: string;
    pubsubTopic?: string;
    // Common OAuth settings
    clientId?: string; // Usually from environment, but could be per-provider
    customScopes?: string[];
  };
  created_at: string; // ISO date
  updated_at: string; // ISO date
}

export interface EmailMessage {
  id: string;
  provider: 'microsoft' | 'google';
  providerId: string;
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
  tenant: string;
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
      companyId: string;
      companyName: string;
      contactId?: string;
      contactName?: string;
    };
  };
}

export interface EmailConnectionStatus {
  connected: boolean;
  status: 'connected' | 'disconnected' | 'error';
  companyName?: string;
  providerId?: string;
  errorMessage?: string;
  lastConnectionTest?: string;
}

export interface EmailQueueJob {
  id: string;
  tenant: string;
  provider: 'microsoft' | 'google';
  messageId: string;
  providerId: string;
  webhookData: any;
  attempt: number;
  createdAt: string;
}