'use server';

import { withAuth } from '@alga-psa/auth';
import { hasPermission } from '@alga-psa/auth/rbac';
import { featureFlags } from '@alga-psa/core/server';
import type { IUserWithRoles } from '@alga-psa/types';
import { getDefaultQboRealmId } from '@alga-psa/integrations/lib/qbo/qboClientService';
import logger from '@alga-psa/core/logger';

import {
  previewQboItemImportForTenant,
  executeQboItemImportForTenant,
  type QboItemImportOptions,
  type QboItemImportPreview,
  type QboItemImportResult
} from '../services/accountingSync/qboItemImportService';

const FEATURE_FLAG_KEY = 'qbo-item-import';

// ─── EE + flag + permission guards ───────────────────────────────────────────

function isEnterpriseEdition(): boolean {
  return (
    (process.env.EDITION ?? '').toLowerCase() === 'ee' ||
    (process.env.NEXT_PUBLIC_EDITION ?? '').toLowerCase() === 'enterprise'
  );
}

function assertEnterpriseEdition(): void {
  if (!isEnterpriseEdition()) {
    throw new Error('QuickBooks Online item import is only available in Enterprise Edition.');
  }
}

async function assertFeatureEnabled(user: IUserWithRoles, tenant: string): Promise<void> {
  const enabled = await featureFlags.isEnabled(FEATURE_FLAG_KEY, {
    userId: user.user_id,
    tenantId: tenant
  });
  if (!enabled) {
    // Typed error, never silent success: a flagged-off tenant calling the
    // action directly must hear "not enabled", not get an empty import.
    throw new Error('The QuickBooks products & services import is not enabled for this account.');
  }
}

async function requirePermission(user: IUserWithRoles, resource: string, action: string): Promise<void> {
  const allowed = await hasPermission(user, resource, action);
  if (!allowed) throw new Error('Forbidden');
}

async function requireDefaultRealm(tenantId: string): Promise<string> {
  const realm = await getDefaultQboRealmId(tenantId);
  if (!realm) throw new Error('No QuickBooks company is connected.');
  return realm;
}

// ─── Actions ─────────────────────────────────────────────────────────────────

export const previewQboItemImport = withAuth(async (
  user,
  { tenant },
  options: QboItemImportOptions
): Promise<QboItemImportPreview> => {
  assertEnterpriseEdition();
  await assertFeatureEnabled(user, tenant);
  await requirePermission(user, 'billing_settings', 'read');

  const realm = await requireDefaultRealm(tenant);

  try {
    return await previewQboItemImportForTenant({ tenant, realm, options });
  } catch (error) {
    logger.error('[qboItemImport] Preview failed', {
      tenant, realm, error: error instanceof Error ? error.message : error
    });
    throw new Error('Failed to load QuickBooks products & services. Please check the QuickBooks connection and try again.');
  }
});

export const executeQboItemImport = withAuth(async (
  user,
  { tenant },
  options: QboItemImportOptions
): Promise<QboItemImportResult> => {
  assertEnterpriseEdition();
  await assertFeatureEnabled(user, tenant);
  await requirePermission(user, 'billing_settings', 'update');
  await requirePermission(user, 'service', 'create');

  const realm = await requireDefaultRealm(tenant);

  try {
    return await executeQboItemImportForTenant({ tenant, realm, options, userId: user.user_id });
  } catch (error) {
    logger.error('[qboItemImport] Execute failed', {
      tenant, realm, error: error instanceof Error ? error.message : error
    });
    throw new Error('The QuickBooks products & services import failed. No further rows were processed.');
  }
});
