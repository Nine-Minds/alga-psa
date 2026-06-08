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

export interface PendingDeletionSummary extends ActivePendingDeletion {
  reactivatable: boolean;
}

export interface TenantEmailResolution {
  tenantId: string;
  tenantName: string | null;
  tenantEmail: string | null;
  adminEmail: string | null;
  matchedBy: 'tenant_email' | 'internal_admin';
}

export interface ReactivationContactEmailResolution {
  email: string;
  source: 'tenant_email';
}

export interface TenantStripeCustomerResolution {
  stripeCustomerId: string | null;
  source: 'stripe_customer' | 'pending_subscription' | null;
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
  const summary = await getPendingDeletionSummary(tenantId, knex);
  return summary?.reactivatable ? summary : null;
}

export async function getPendingDeletionSummary(
  tenantId: string,
  knex?: KnexLike,
): Promise<PendingDeletionSummary | null> {
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

    if (!row) {
      return null;
    }

    return {
      deletionId: row.deletion_id,
      status: row.status,
      reactivatable: isReactivatableDeletionStatus(row.status),
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

/**
 * Canonical reactivation contact resolver.
 *
 * The reactivation authority anchor is the tenant's billing/owner email
 * (`tenants.email`) — the SAME address the forced password-reset
 * (`triggerReactivationPasswordReset`) targets after payment. Pinning the
 * invite, the login win-back nudge, and the post-payment set-password email to
 * one field guarantees the token, the checkout, and account access all land in
 * the same inbox (PRD §12 authority chain). No fallback chain: if the canonical
 * email is missing we send nothing rather than diverting reactivation to a
 * different recipient than the password reset.
 */
export async function resolveReactivationContactEmail(
  tenantId: string,
  knex?: KnexLike,
): Promise<ReactivationContactEmailResolution | null> {
  const db = await getKnex(knex);

  const tenant = await db('tenants')
    .where('tenant', tenantId)
    .first('email');

  if (tenant?.email) {
    return { email: tenant.email, source: 'tenant_email' };
  }

  return null;
}

export async function resolveTenantStripeCustomerForReactivation(
  tenantId: string,
  pendingDeletion?: PendingDeletionSummary | ActivePendingDeletion | null,
  knex?: KnexLike,
): Promise<TenantStripeCustomerResolution> {
  const db = await getKnex(knex);

  const stripeCustomer = await db('stripe_customers')
    .where('tenant', tenantId)
    .whereNotNull('stripe_customer_external_id')
    .orderBy('created_at', 'desc')
    .first('stripe_customer_external_id');

  if (stripeCustomer?.stripe_customer_external_id) {
    return {
      stripeCustomerId: stripeCustomer.stripe_customer_external_id,
      source: 'stripe_customer',
    };
  }

  if (pendingDeletion?.subscriptionExternalId) {
    return {
      stripeCustomerId: pendingDeletion.subscriptionExternalId,
      source: 'pending_subscription',
    };
  }

  return {
    stripeCustomerId: null,
    source: null,
  };
}
