'use server';

import logger from '@alga-psa/core/logger';
import { getCurrentUser } from '@alga-psa/users/actions';
import { hasPermission } from '@alga-psa/auth/rbac';
import { revalidatePath } from 'next/cache';
import { getSecretProviderInstance } from '@alga-psa/core/secrets';
import {
  XeroClientService,
  getXeroConnectionSummaries,
  type XeroConnectionSummary,
  XERO_CREDENTIALS_SECRET_NAME
} from '../../lib/xero/xeroClientService';

type BillingAccess = {
  tenantId: string;
};

async function ensureBillingReadAccess(): Promise<BillingAccess> {
  const user = await getCurrentUser();
  if (!user?.tenant) {
    throw new Error('Authentication required.');
  }

  const allowed = await hasPermission(user, 'billing_settings', 'read');
  if (!allowed) {
    throw new Error('Forbidden');
  }

  return {
    tenantId: user.tenant
  };
}

async function ensureBillingUpdateAccess(): Promise<BillingAccess> {
  const user = await getCurrentUser();
  if (!user?.tenant) {
    throw new Error('Authentication required.');
  }

  const allowed = await hasPermission(user, 'billing_settings', 'update');
  if (!allowed) {
    throw new Error('Forbidden');
  }

  return {
    tenantId: user.tenant
  };
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

export async function disconnectXero(): Promise<{ success: boolean; error?: string }> {
  let tenantId: string | null = null;

  try {
    ({ tenantId } = await ensureBillingUpdateAccess());
    const secretProvider = await getSecretProviderInstance();

    logger.info('[xeroActions] Disconnecting Xero integration', { tenantId });
    await secretProvider.deleteTenantSecret(tenantId, XERO_CREDENTIALS_SECRET_NAME);

    revalidatePath('/settings/integrations/xero');

    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'An unexpected error occurred during disconnection.';
    logger.error('[xeroActions] Xero disconnect failed', { tenantId, error });
    return { success: false, error: message };
  }
}

export async function getXeroConnectionStatus(): Promise<XeroConnectionStatus> {
  const { tenantId } = await ensureBillingReadAccess();
  const summaries = await getXeroConnectionSummaries(tenantId);

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
      await XeroClientService.create(tenantId, summary.connectionId);
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
}

// Backwards-compatible alias used by older callers.
export const getXeroIntegrationStatus = getXeroConnectionStatus;

export async function getXeroAccounts(connectionId?: string | null): Promise<XeroAccountOption[]> {
  const { tenantId } = await ensureBillingReadAccess();

  try {
    const client = await XeroClientService.create(tenantId, connectionId ?? null);
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
}

export async function getXeroItems(connectionId?: string | null): Promise<XeroItemOption[]> {
  const { tenantId } = await ensureBillingReadAccess();

  try {
    const client = await XeroClientService.create(tenantId, connectionId ?? null);
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
}

export async function getXeroTaxRates(connectionId?: string | null): Promise<XeroTaxRateOption[]> {
  const { tenantId } = await ensureBillingReadAccess();

  try {
    const client = await XeroClientService.create(tenantId, connectionId ?? null);
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
}

export async function getXeroTrackingCategories(
  connectionId?: string | null
): Promise<XeroTrackingCategoryOption[]> {
  const { tenantId } = await ensureBillingReadAccess();

  try {
    const client = await XeroClientService.create(tenantId, connectionId ?? null);
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
}
