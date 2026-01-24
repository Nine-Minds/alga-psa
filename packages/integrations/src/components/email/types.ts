export interface EmailProvider {
  id: string;
  tenant: string;
  providerType: 'microsoft' | 'google' | 'imap';
  providerName: string;
  mailbox: string;
  isActive: boolean;
  status: 'connected' | 'disconnected' | 'error' | 'configuring';
  lastSyncAt?: string;
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
  inboundTicketDefaultsId?: string;
  // Vendor-specific config will be loaded separately
  microsoftConfig?: MicrosoftEmailProviderConfig;
  googleConfig?: GoogleEmailProviderConfig;
  imapConfig?: ImapEmailProviderConfig;
}

export interface MicrosoftEmailProviderConfig {
  email_provider_id: string;
  tenant: string;
  client_id: string | null;
  client_secret: string | null;
  tenant_id: string;
  redirect_uri: string;
  auto_process_emails: boolean;
  max_emails_per_sync: number;
  folder_filters: string[];
  access_token?: string;
  refresh_token?: string;
  token_expires_at?: string;
  webhook_subscription_id?: string;
  webhook_verification_token?: string; // Added to match database
  webhook_expires_at?: string;
  last_subscription_renewal?: string; // Added to match database
  created_at: string;
  updated_at: string;
}

export interface GoogleEmailProviderConfig {
  email_provider_id: string;
  tenant: string;
  client_id: string | null;
  client_secret: string | null;
  project_id?: string | null;
  redirect_uri?: string | null;
  auto_process_emails: boolean;
  max_emails_per_sync: number;
  label_filters: string[];
  access_token?: string;
  refresh_token?: string;
  token_expires_at?: string;
  history_id?: string;
  watch_expiration?: string;
  pubsub_initialised_at?: string;
  created_at: string;
  updated_at: string;
}

export interface ImapEmailProviderConfig {
  email_provider_id: string;
  tenant: string;
  host: string;
  port: number;
  secure: boolean;
  allow_starttls: boolean;
  auth_type: 'password' | 'oauth2';
  username: string;
  password?: string;
  folder_filters: string[];
  auto_process_emails: boolean;
  max_emails_per_sync: number;
  oauth_authorize_url?: string | null;
  oauth_token_url?: string | null;
  oauth_client_id?: string | null;
  oauth_client_secret?: string | null;
  oauth_scopes?: string | null;
  access_token?: string;
  refresh_token?: string;
  token_expires_at?: string;
  uid_validity?: string;
  last_uid?: string;
  folder_state?: Record<string, { uid_validity?: string; last_uid?: string; last_seen_at?: string }>;
  last_processed_message_id?: string;
  server_capabilities?: string | null;
  lease_owner?: string | null;
  lease_expires_at?: string | null;
  connection_timeout_ms?: number | null;
  socket_keepalive?: boolean | null;
  last_seen_at?: string;
  last_sync_at?: string;
  last_error?: string;
  created_at: string;
  updated_at: string;
}
