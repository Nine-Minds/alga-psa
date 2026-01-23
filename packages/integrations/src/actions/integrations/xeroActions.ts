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
  XERO_CREDENTIALS_SECRET_NAME
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
  error?: string;
}

export const disconnectXero = withAuth(async (
  user,
  { tenant }
): Promise<{ success: boolean; error?: string }> => {
  try {
    await checkBillingUpdateAccess(user);
    const secretProvider = await getSecretProviderInstance();

    logger.info('[xeroActions] Disconnecting Xero integration', { tenantId: tenant });
    await secretProvider.deleteTenantSecret(tenant, XERO_CREDENTIALS_SECRET_NAME);

    revalidatePath('/settings/integrations/xero');

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
  await checkBillingReadAccess(user);
  const summaries = await getXeroConnectionSummaries(tenant);

  if (summaries.length === 0) {
    return {
      connections: [],
      connected: false,
      error: 'No Xero connections configured.'
    };
  }

  let connected = false;
  let error: string | undefined;

  for (const summary of summaries) {
    try {
      await XeroClientService.create(tenant, summary.connectionId);
      connected = true;
      error = undefined;
      break;
    } catch (err) {
      if (!error) {
        error = err instanceof Error ? err.message : 'Failed to connect to Xero.';
      }
      continue;
    }
  }

  return {
    connections: summaries,
    connected,
    defaultConnectionId: summaries[0]?.connectionId,
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
