import type { EmailProviderConfig } from '../../interfaces/inbound-email.interfaces';
import type { Microsoft365DiagnosticsReport } from '../../interfaces/microsoft365-diagnostics.interfaces';
import { MicrosoftGraphAdapter } from './providers/MicrosoftGraphAdapter';

export interface MicrosoftOAuthCallbackDiagnosticInput {
  provider: {
    id: string;
    tenant: string;
    provider_name?: string | null;
    mailbox: string;
    is_active: boolean;
    status?: string | null;
    created_at: string;
    updated_at: string;
  };
  vendorConfig: Record<string, any>;
  accessToken: string;
  refreshToken?: string | null;
  expiresAt: Date;
}

export interface StoredMicrosoftOAuthCallbackDiagnostic {
  source: 'oauth_callback';
  createdAt: string;
  report: Microsoft365DiagnosticsReport;
}

/** Run callback-time diagnostics with fresh in-memory credentials, without persisting any refresh. */
export async function runMicrosoftOAuthCallbackDiagnostic(
  input: MicrosoftOAuthCallbackDiagnosticInput,
  createAdapter: (config: EmailProviderConfig) => MicrosoftGraphAdapter = (config) =>
    new MicrosoftGraphAdapter(config, { persistRefreshedCredentials: false }),
): Promise<StoredMicrosoftOAuthCallbackDiagnostic> {
  const { provider, vendorConfig } = input;
  const config: EmailProviderConfig = {
    id: provider.id,
    tenant: provider.tenant,
    name: provider.provider_name || provider.mailbox,
    provider_type: 'microsoft',
    mailbox: provider.mailbox,
    folder_to_monitor: Array.isArray(vendorConfig.folder_filters) ? vendorConfig.folder_filters[0] || 'Inbox' : 'Inbox',
    active: provider.is_active,
    webhook_notification_url: '',
    connection_status: provider.status === 'connected' ? 'connected' : 'error',
    provider_config: {
      ...vendorConfig,
      access_token: input.accessToken,
      refresh_token: input.refreshToken || undefined,
      token_expires_at: input.expiresAt.toISOString(),
    },
    created_at: provider.created_at,
    updated_at: provider.updated_at,
  };
  const report = await createAdapter(config).runMicrosoft365Diagnostics({
    includeIdentifiers: true,
    liveSubscriptionTest: false,
  });
  return { source: 'oauth_callback', createdAt: new Date().toISOString(), report };
}
