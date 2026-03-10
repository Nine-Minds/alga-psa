'use server';

import logger from '@alga-psa/core/logger';
import { withAuth } from '@alga-psa/auth';
import { hasPermission } from '@alga-psa/auth/rbac';
import { revalidatePath } from 'next/cache';
import { getSecretProviderInstance } from '@alga-psa/core/secrets';
import {
  XeroClientService,
  getXeroConnectionSummaries,
  type XeroConnectionSummary,
  XERO_CREDENTIALS_SECRET_NAME,
  XERO_CLIENT_ID_SECRET_NAME,
  XERO_CLIENT_SECRET_SECRET_NAME,
  getXeroRedirectUri,
  getXeroOAuthScopes
} from '../../lib/xero/xeroClientService';
import type { IUserWithRoles } from '@alga-psa/types';

async function checkBillingReadAccess(user: IUserWithRoles): Promise<void> {
  const allowed = await hasPermission(user, 'billing_settings', 'read');
  if (!allowed) {
    throw new Error('Forbidden');
  }
}

async function checkBillingUpdateAccess(user: IUserWithRoles): Promise<void> {
  const allowed = await hasPermission(user, 'billing_settings', 'update');
  if (!allowed) {
    throw new Error('Forbidden');
  }
}

function isEnterpriseEdition(): boolean {
  return (
    (process.env.EDITION ?? '').toLowerCase() === 'ee' ||
    (process.env.NEXT_PUBLIC_EDITION ?? '').toLowerCase() === 'enterprise'
  );
}

function assertEnterpriseEdition(): void {
  if (!isEnterpriseEdition()) {
    throw new Error('Xero integration is only available in Enterprise Edition.');
  }
}

function maskSecret(value: string): string {
  if (!value) return '';
  if (value.length <= 4) return '•'.repeat(value.length);
  return `${'•'.repeat(Math.max(0, value.length - 4))}${value.slice(-4)}`;
}

function formatXeroStatusError(error: unknown): string {
  const message = error instanceof Error ? error.message : 'Failed to connect to Xero.';

  if (message.includes('XERO_REFRESH_EXPIRED')) {
    return 'Your default Xero connection has expired. Disconnect and reconnect Xero to continue.';
  }

  if (message.includes('re-authentication required')) {
    return 'Your default Xero connection has expired. Disconnect and reconnect Xero to continue.';
  }

  return message;
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
}

export const saveXeroCredentials = withAuth(async (
  user,
  { tenant },
  input: { clientId: string; clientSecret: string }
): Promise<{ success: boolean; error?: string }> => {
  try {
    assertEnterpriseEdition();
    await checkBillingUpdateAccess(user);

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
    const message =
      error instanceof Error ? error.message : 'An unexpected error occurred while saving Xero credentials.';
    logger.error('[xeroActions] Failed to save tenant-owned Xero OAuth credentials', {
      tenantId: tenant,
      error
    });
    return { success: false, error: message };
  }
});

export const disconnectXero = withAuth(async (
  user,
  { tenant }
): Promise<{ success: boolean; error?: string }> => {
  try {
    assertEnterpriseEdition();
    await checkBillingUpdateAccess(user);
    const secretProvider = await getSecretProviderInstance();

    logger.info('[xeroActions] Disconnecting Xero integration', { tenantId: tenant });
    await secretProvider.deleteTenantSecret(tenant, XERO_CREDENTIALS_SECRET_NAME);

    revalidatePath('/msp/settings');

    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'An unexpected error occurred during disconnection.';
    logger.error('[xeroActions] Xero disconnect failed', { tenantId: tenant, error });
    return { success: false, error: message };
  }
});

export const getXeroConnectionStatus = withAuth(async (
  user,
  { tenant }
): Promise<XeroConnectionStatus> => {
  assertEnterpriseEdition();
  await checkBillingReadAccess(user);
  const secretProvider = await getSecretProviderInstance();
  const [storedClientId, storedClientSecret, redirectUri] = await Promise.all([
    secretProvider.getTenantSecret(tenant, XERO_CLIENT_ID_SECRET_NAME),
    secretProvider.getTenantSecret(tenant, XERO_CLIENT_SECRET_SECRET_NAME),
    getXeroRedirectUri(secretProvider)
  ]);
  const clientId = typeof storedClientId === 'string' ? storedClientId.trim() : '';
  const clientSecret = typeof storedClientSecret === 'string' ? storedClientSecret.trim() : '';
  const summaries = await getXeroConnectionSummaries(tenant);
  const defaultConnection = summaries[0];
  const credentials = {
    clientIdConfigured: Boolean(clientId),
    clientSecretConfigured: Boolean(clientSecret),
    ready: Boolean(clientId && clientSecret),
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
): Promise<XeroAccountOption[]> => {
  await checkBillingReadAccess(user);

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
    console.error('[xeroActions] Failed to load Xero accounts', error);
    return [];
  }
});

export const getXeroItems = withAuth(async (
  user,
  { tenant },
  connectionId?: string | null
): Promise<XeroItemOption[]> => {
  await checkBillingReadAccess(user);

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
    console.error('[xeroActions] Failed to load Xero items', error);
    return [];
  }
});

export const getXeroTaxRates = withAuth(async (
  user,
  { tenant },
  connectionId?: string | null
): Promise<XeroTaxRateOption[]> => {
  await checkBillingReadAccess(user);

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
    console.error('[xeroActions] Failed to load Xero tax rates', error);
    return [];
  }
});

export const getXeroTrackingCategories = withAuth(async (
  user,
  { tenant },
  connectionId?: string | null
): Promise<XeroTrackingCategoryOption[]> => {
  await checkBillingReadAccess(user);

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
    console.error('[xeroActions] Failed to load Xero tracking categories', error);
    return [];
  }
});
