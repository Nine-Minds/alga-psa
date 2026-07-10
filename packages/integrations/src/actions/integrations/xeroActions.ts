'use server';

import logger from '@alga-psa/core/logger';
import { withAuth } from '@alga-psa/auth';
import { hasPermission } from '@alga-psa/auth/rbac';
import { revalidatePath } from 'next/cache';
import { getSecretProviderInstance } from '@alga-psa/core/secrets';
import {
  actionError,
  permissionError,
  type ActionMessageError,
  type ActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';
import {
  XeroClientService,
  getXeroConnectionSummaries,
  type XeroConnectionSummary,
  XERO_CREDENTIALS_SECRET_NAME,
  XERO_CLIENT_ID_SECRET_NAME,
  XERO_CLIENT_SECRET_SECRET_NAME,
  getXeroRedirectUri,
  getXeroOAuthScopes,
  resolveXeroOAuthCredentials
} from '../../lib/xero/xeroClientService';
import type { IUserWithRoles } from '@alga-psa/types';

type XeroCatalogActionError = ActionMessageError | ActionPermissionError;
type XeroCatalogResult<T> = Promise<T[] | XeroCatalogActionError>;

async function checkBillingReadAccess(user: IUserWithRoles): Promise<void> {
  const allowed = await hasPermission(user, 'billing_settings', 'read');
  if (!allowed) {
    throw new Error('Forbidden: You do not have permission to view Xero integration settings.');
  }
}

async function getXeroCatalogAccessError(user: IUserWithRoles): Promise<XeroCatalogActionError | null> {
  if (!isEnterpriseEdition()) {
    return actionError('Xero integration is only available in Enterprise Edition.');
  }

  const allowed = await hasPermission(user, 'billing_settings', 'read');
  if (!allowed) {
    return permissionError('Forbidden: You do not have permission to view Xero integration settings.');
  }

  return null;
}

function isEnterpriseEdition(): boolean {
  return (
    (process.env.EDITION ?? '').toLowerCase() === 'ee' ||
    (process.env.NEXT_PUBLIC_EDITION ?? '').toLowerCase() === 'enterprise'
  );
}

function maskSecret(value: string): string {
  if (!value) return '';
  if (value.length <= 4) return '•'.repeat(value.length);
  return `${'•'.repeat(Math.max(0, value.length - 4))}${value.slice(-4)}`;
}

function xeroErrorCode(error: unknown): string | null {
  if (!error || typeof error !== 'object') {
    return null;
  }

  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : null;
}

function formatXeroStatusError(error: unknown): string {
  const code = xeroErrorCode(error);
  const message = error instanceof Error ? error.message : '';

  if (code === 'XERO_REFRESH_EXPIRED' || message.includes('XERO_REFRESH_EXPIRED')) {
    return 'Your default Xero connection has expired. Disconnect and reconnect Xero to continue.';
  }

  if (message.includes('re-authentication required')) {
    return 'Your default Xero connection has expired. Disconnect and reconnect Xero to continue.';
  }

  if (code === 'XERO_CONFIG_MISSING') {
    return 'Xero client credentials are not configured. Add credentials and reconnect Xero.';
  }

  if (code === 'XERO_NOT_CONFIGURED') {
    return 'No live Xero organisation is connected yet. Save credentials, then click Connect Xero.';
  }

  if (code === 'XERO_CONNECTION_NOT_FOUND') {
    return 'The selected Xero organisation is no longer connected. Reconnect Xero and try again.';
  }

  if (isXeroReconnectError(error)) {
    return 'Your default Xero connection has expired. Disconnect and reconnect Xero to continue.';
  }

  return 'Failed to connect to Xero. Try again, or reconnect Xero if the problem persists.';
}

export interface XeroAccountOption {
  id: string;
  name: string;
  code?: string;
  type?: string;
}

export interface XeroItemOption {
  id: string;
  name: string;
  code?: string;
  status?: string;
}

export interface XeroTaxRateOption {
  id: string;
  name: string;
  taxType?: string;
  effectiveRate?: number | null;
  components: Array<{ name: string; rate: number }>;
  status?: string;
}

export interface XeroTrackingCategoryOption {
  id: string;
  name: string;
  status?: string;
  options: Array<{ id: string; name: string; status?: string }>;
}

export interface XeroConnectionStatus {
  connections: XeroConnectionSummary[];
  connected: boolean;
  defaultConnectionId?: string;
  defaultConnection?: XeroConnectionSummary;
  redirectUri: string;
  scopes: string[];
  credentials: {
    clientIdConfigured: boolean;
    clientSecretConfigured: boolean;
    ready: boolean;
    clientIdMasked?: string;
    clientSecretMasked?: string;
  };
  error?: string;
  errorCode?: 'FORBIDDEN' | 'ENTERPRISE_REQUIRED';
}

function xeroConnectionStatusError(
  error: string,
  errorCode: NonNullable<XeroConnectionStatus['errorCode']>
): XeroConnectionStatus {
  return {
    connections: [],
    connected: false,
    redirectUri: '',
    scopes: getXeroOAuthScopes(),
    credentials: {
      clientIdConfigured: false,
      clientSecretConfigured: false,
      ready: false,
    },
    error,
    errorCode,
  };
}

function isXeroReconnectError(error: unknown): boolean {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return (
    message.includes('xero_refresh_expired') ||
    message.includes('re-authentication') ||
    message.includes('refresh token') ||
    message.includes('invalid_grant') ||
    message.includes('unauthorized') ||
    message.includes('expired') ||
    message.includes('401')
  );
}

function xeroCatalogFetchError(catalogName: string, error: unknown): XeroCatalogActionError {
  if (isXeroReconnectError(error)) {
    return actionError(`Reconnect Xero before loading ${catalogName}.`);
  }

  return actionError(
    `Could not load ${catalogName}. Try again, or reconnect Xero if the problem persists.`
  );
}

async function getXeroCatalogConnectionError(
  tenantId: string,
  connectionId: string | null | undefined,
  catalogName: string
): Promise<XeroCatalogActionError | null> {
  try {
    const summaries = await getXeroConnectionSummaries(tenantId);
    if (summaries.length === 0) {
      return actionError(`Connect Xero before loading ${catalogName}.`);
    }

    const selectedConnection = connectionId
      ? summaries.find((summary) => summary.connectionId === connectionId)
      : summaries[0];

    if (!selectedConnection) {
      return actionError('The selected Xero organisation is no longer connected. Reconnect Xero and try again.');
    }

    if (selectedConnection.status === 'expired') {
      return actionError(`Reconnect Xero before loading ${catalogName}.`);
    }

    return null;
  } catch (error) {
    logger.error('[xeroActions] Failed to verify Xero connection before loading catalog data', {
      tenantId,
      connectionId,
      catalogName,
      error
    });
    return actionError(`Could not verify the Xero connection before loading ${catalogName}. Try again.`);
  }
}

async function getXeroUpdateAccessError(user: IUserWithRoles): Promise<string | null> {
  if (!isEnterpriseEdition()) {
    return 'Xero integration is only available in Enterprise Edition.';
  }

  const allowed = await hasPermission(user, 'billing_settings', 'update');
  if (!allowed) {
    return 'Forbidden: You do not have permission to manage Xero integration settings.';
  }

  return null;
}

export const saveXeroCredentials = withAuth(async (
  user,
  { tenant },
  input: { clientId: string; clientSecret: string }
): Promise<{ success: boolean; error?: string }> => {
  try {
    const accessError = await getXeroUpdateAccessError(user);
    if (accessError) {
      return { success: false, error: accessError };
    }

    const clientId = input.clientId?.trim();
    if (!clientId) {
      return { success: false, error: 'Xero client ID is required.' };
    }

    const clientSecret = input.clientSecret?.trim();
    if (!clientSecret) {
      return { success: false, error: 'Xero client secret is required.' };
    }

    const secretProvider = await getSecretProviderInstance();
    await secretProvider.setTenantSecret(tenant, XERO_CLIENT_ID_SECRET_NAME, clientId);
    await secretProvider.setTenantSecret(tenant, XERO_CLIENT_SECRET_SECRET_NAME, clientSecret);

    logger.info('[xeroActions] Saved tenant-owned Xero OAuth credentials', {
      tenantId: tenant,
      clientIdConfigured: true,
      clientSecretConfigured: true
    });

    revalidatePath('/msp/settings');
    return { success: true };
  } catch (error) {
    logger.error('[xeroActions] Failed to save tenant-owned Xero OAuth credentials', {
      tenantId: tenant,
      error
    });
    return { success: false, error: 'Failed to save Xero credentials. Please try again.' };
  }
});

export const disconnectXero = withAuth(async (
  user,
  { tenant }
): Promise<{ success: boolean; error?: string }> => {
  try {
    const accessError = await getXeroUpdateAccessError(user);
    if (accessError) {
      return { success: false, error: accessError };
    }
    const secretProvider = await getSecretProviderInstance();

    logger.info('[xeroActions] Disconnecting Xero integration', { tenantId: tenant });
    await secretProvider.deleteTenantSecret(tenant, XERO_CREDENTIALS_SECRET_NAME);

    revalidatePath('/msp/settings');

    return { success: true };
  } catch (error) {
    logger.error('[xeroActions] Xero disconnect failed', { tenantId: tenant, error });
    return { success: false, error: 'Failed to disconnect Xero. Please try again.' };
  }
});

export const getXeroConnectionStatus = withAuth(async (
  user,
  { tenant }
): Promise<XeroConnectionStatus> => {
  if (!isEnterpriseEdition()) {
    return xeroConnectionStatusError(
      'Xero integration is only available in Enterprise Edition.',
      'ENTERPRISE_REQUIRED',
    );
  }

  try {
    await checkBillingReadAccess(user);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Forbidden')) {
      return xeroConnectionStatusError(error.message, 'FORBIDDEN');
    }
    throw error;
  }

  const secretProvider = await getSecretProviderInstance();
  const [storedClientId, storedClientSecret, redirectUri, resolvedCredentials] = await Promise.all([
    secretProvider.getTenantSecret(tenant, XERO_CLIENT_ID_SECRET_NAME),
    secretProvider.getTenantSecret(tenant, XERO_CLIENT_SECRET_SECRET_NAME),
    getXeroRedirectUri(secretProvider),
    resolveXeroOAuthCredentials(tenant, secretProvider).catch(() => null)
  ]);
  const clientId = typeof storedClientId === 'string' ? storedClientId.trim() : '';
  const clientSecret = typeof storedClientSecret === 'string' ? storedClientSecret.trim() : '';
  const summaries = await getXeroConnectionSummaries(tenant);
  const defaultConnection = summaries[0];
  const credentials = {
    clientIdConfigured: Boolean(clientId),
    clientSecretConfigured: Boolean(clientSecret),
    ready: Boolean(resolvedCredentials),
    clientIdMasked: clientId ? maskSecret(clientId) : undefined,
    clientSecretMasked: clientSecret ? maskSecret(clientSecret) : undefined
  };

  let connected = false;
  let error: string | undefined;

  if (!credentials.ready) {
    error = 'Add a Xero client ID and client secret before connecting live Xero.';
  } else if (!defaultConnection) {
    error = 'No live Xero organisation is connected yet. Save credentials, then click Connect Xero.';
  } else {
    try {
      await XeroClientService.create(tenant, defaultConnection.connectionId);
      connected = true;
    } catch (err) {
      error = formatXeroStatusError(err);
    }
  }

  return {
    connections: summaries,
    connected,
    defaultConnectionId: defaultConnection?.connectionId,
    defaultConnection,
    redirectUri,
    scopes: getXeroOAuthScopes(),
    credentials,
    error
  };
});

// Backwards-compatible alias used by older callers.
export const getXeroIntegrationStatus = getXeroConnectionStatus;

export const getXeroAccounts = withAuth(async (
  user,
  { tenant },
  connectionId?: string | null
): XeroCatalogResult<XeroAccountOption> => {
  const accessError = await getXeroCatalogAccessError(user);
  if (accessError) return accessError;

  const connectionError = await getXeroCatalogConnectionError(tenant, connectionId, 'Xero accounts');
  if (connectionError) return connectionError;

  try {
    const client = await XeroClientService.create(tenant, connectionId ?? null);
    const accounts = await client.listAccounts({ status: 'ACTIVE' });
    return accounts.map((account) => ({
      id: account.accountId,
      name: account.name,
      code: account.code ?? undefined,
      type: account.type ?? undefined
    }));
  } catch (error) {
    logger.warn('[xeroActions] Failed to load Xero accounts', { tenantId: tenant, connectionId, error });
    return xeroCatalogFetchError('Xero accounts', error);
  }
});

export const getXeroItems = withAuth(async (
  user,
  { tenant },
  connectionId?: string | null
): XeroCatalogResult<XeroItemOption> => {
  const accessError = await getXeroCatalogAccessError(user);
  if (accessError) return accessError;

  const connectionError = await getXeroCatalogConnectionError(tenant, connectionId, 'Xero items');
  if (connectionError) return connectionError;

  try {
    const client = await XeroClientService.create(tenant, connectionId ?? null);
    const items = await client.listItems();
    return items.map((item) => ({
      id: item.itemId,
      name: item.name,
      code: item.code ?? undefined,
      status: item.status ?? undefined
    }));
  } catch (error) {
    logger.warn('[xeroActions] Failed to load Xero items', { tenantId: tenant, connectionId, error });
    return xeroCatalogFetchError('Xero items', error);
  }
});

export const getXeroTaxRates = withAuth(async (
  user,
  { tenant },
  connectionId?: string | null
): XeroCatalogResult<XeroTaxRateOption> => {
  const accessError = await getXeroCatalogAccessError(user);
  if (accessError) return accessError;

  const connectionError = await getXeroCatalogConnectionError(tenant, connectionId, 'Xero tax rates');
  if (connectionError) return connectionError;

  try {
    const client = await XeroClientService.create(tenant, connectionId ?? null);
    const rates = await client.listTaxRates();
    return rates.map((rate) => ({
      id: rate.taxRateId,
      name: rate.name,
      taxType: rate.taxType ?? undefined,
      effectiveRate: rate.effectiveRate ?? null,
      components: rate.components ?? [],
      status: rate.status ?? undefined
    }));
  } catch (error) {
    logger.warn('[xeroActions] Failed to load Xero tax rates', { tenantId: tenant, connectionId, error });
    return xeroCatalogFetchError('Xero tax rates', error);
  }
});

export const getXeroTrackingCategories = withAuth(async (
  user,
  { tenant },
  connectionId?: string | null
): XeroCatalogResult<XeroTrackingCategoryOption> => {
  const accessError = await getXeroCatalogAccessError(user);
  if (accessError) return accessError;

  const connectionError = await getXeroCatalogConnectionError(tenant, connectionId, 'Xero tracking categories');
  if (connectionError) return connectionError;

  try {
    const client = await XeroClientService.create(tenant, connectionId ?? null);
    const categories = await client.listTrackingCategories();
    return categories.map((category) => ({
      id: category.trackingCategoryId,
      name: category.name,
      status: category.status ?? undefined,
      options: category.options.map((option) => ({
        id: option.trackingOptionId,
        name: option.name,
        status: option.status ?? undefined
      }))
    }));
  } catch (error) {
    logger.warn('[xeroActions] Failed to load Xero tracking categories', { tenantId: tenant, connectionId, error });
    return xeroCatalogFetchError('Xero tracking categories', error);
  }
});
