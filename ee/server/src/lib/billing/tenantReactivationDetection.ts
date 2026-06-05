import { getAdminConnection } from '@alga-psa/db/admin';

const REACTIVATABLE_DELETION_STATUSES = new Set([
  'pending',
  'awaiting_confirmation',
  'confirmed',
]);

export type PendingDeletionStatus =
  | 'pending'
  | 'awaiting_confirmation'
  | 'confirmed'
  | 'deleting'
  | 'deleted'
  | 'rolled_back'
  | 'failed'
  | string;

export interface ActivePendingDeletion {
  deletionId: string;
  status: PendingDeletionStatus;
  reactivatable: boolean;
  effectiveDeletionDate: string | null;
  workflowId: string;
  workflowRunId: string | null;
  subscriptionExternalId: string | null;
  confirmationType: string | null;
}

export interface TenantEmailResolution {
  tenantId: string;
  tenantName: string | null;
  tenantEmail: string | null;
  adminEmail: string | null;
  matchedBy: 'tenant_email' | 'internal_admin';
}

type KnexLike = Awaited<ReturnType<typeof getAdminConnection>>;

function normalizeDate(value: unknown): string | null {
  if (!value) {
    return null;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  return String(value);
}

function isMissingPendingDeletionTableError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }

  const maybeError = error as { code?: string; message?: string };
  return (
    maybeError.code === '42P01' ||
    (typeof maybeError.message === 'string' &&
      maybeError.message.includes('pending_tenant_deletions') &&
      maybeError.message.includes('does not exist'))
  );
}

async function getKnex(knex?: KnexLike): Promise<KnexLike> {
  return knex ?? getAdminConnection();
}

export function isReactivatableDeletionStatus(status: string | null | undefined): boolean {
  return !!status && REACTIVATABLE_DELETION_STATUSES.has(status);
}

export async function getActivePendingDeletion(
  tenantId: string,
  knex?: KnexLike,
): Promise<ActivePendingDeletion | null> {
  try {
    const db = await getKnex(knex);
    const row = await db('pending_tenant_deletions')
      .where({ tenant: tenantId })
      .first(
        'deletion_id',
        'status',
        'workflow_id',
        'workflow_run_id',
        'subscription_external_id',
        'confirmation_type',
        'scheduled_deletion_date',
        'deletion_scheduled_for',
      );

    if (!row || !isReactivatableDeletionStatus(row.status)) {
      return null;
    }

    return {
      deletionId: row.deletion_id,
      status: row.status,
      reactivatable: true,
      effectiveDeletionDate: normalizeDate(row.deletion_scheduled_for ?? row.scheduled_deletion_date),
      workflowId: row.workflow_id,
      workflowRunId: row.workflow_run_id ?? null,
      subscriptionExternalId: row.subscription_external_id ?? null,
      confirmationType: row.confirmation_type ?? null,
    };
  } catch (error) {
    if (isMissingPendingDeletionTableError(error)) {
      return null;
    }

    throw error;
  }
}

export async function resolveTenantAndAdminEmailByEmail(
  email: string,
  knex?: KnexLike,
): Promise<TenantEmailResolution | null> {
  const db = await getKnex(knex);

  const tenant = await db('tenants')
    .where('email', email)
    .first('tenant', 'client_name', 'email');

  if (tenant) {
    return {
      tenantId: tenant.tenant,
      tenantName: tenant.client_name ?? null,
      tenantEmail: tenant.email ?? null,
      adminEmail: tenant.email ?? null,
      matchedBy: 'tenant_email',
    };
  }

  const adminUser = await db('users')
    .where({
      email,
      user_type: 'internal',
    })
    .first('tenant', 'email');

  if (!adminUser) {
    return null;
  }

  const userTenant = await db('tenants')
    .where('tenant', adminUser.tenant)
    .first('tenant', 'client_name', 'email');

  if (!userTenant) {
    return null;
  }

  return {
    tenantId: userTenant.tenant,
    tenantName: userTenant.client_name ?? null,
    tenantEmail: userTenant.email ?? null,
    adminEmail: adminUser.email ?? userTenant.email ?? null,
    matchedBy: 'internal_admin',
  };
}
