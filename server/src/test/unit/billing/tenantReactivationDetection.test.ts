import { describe, expect, it } from 'vitest';

import {
  getActivePendingDeletion,
  resolveReactivationContactEmail,
  resolveTenantAndAdminEmailByEmail,
} from '../../../../../ee/server/src/lib/billing/tenantReactivationDetection';

type Row = Record<string, any>;

function createFakeKnex(tables: Record<string, Row[]>) {
  return ((tableName: string) => {
    let rows = [...(tables[tableName] ?? [])];

    const builder = {
      where(criteria: string | Row, value?: unknown) {
        if (typeof criteria === 'string') {
          rows = rows.filter((row) => row[criteria] === value);
        } else {
          rows = rows.filter((row) =>
            Object.entries(criteria).every(([key, expected]) => row[key] === expected),
          );
        }
        return builder;
      },
      whereNotNull(column: string) {
        rows = rows.filter((row) => row[column] !== null && row[column] !== undefined);
        return builder;
      },
      orderBy() {
        return builder;
      },
      async first(...columns: string[]) {
        const row = rows[0];
        if (!row || columns.length === 0) {
          return row;
        }

        return Object.fromEntries(columns.map((column) => [column, row[column]]));
      },
    };

    return builder;
  }) as any;
}

describe('tenant reactivation detection', () => {
  it('T002: getActivePendingDeletion returns pending, awaiting_confirmation, and confirmed rows', async () => {
    for (const status of ['pending', 'awaiting_confirmation', 'confirmed']) {
      const knex = createFakeKnex({
        pending_tenant_deletions: [{
          deletion_id: `deletion-${status}`,
          tenant: 'tenant-1',
          status,
          workflow_id: `workflow-${status}`,
          workflow_run_id: `run-${status}`,
          subscription_external_id: `sub-${status}`,
          confirmation_type: status === 'confirmed' ? '30_days' : null,
          scheduled_deletion_date: new Date('2026-08-01T00:00:00.000Z'),
          deletion_scheduled_for: status === 'confirmed'
            ? new Date('2026-07-01T00:00:00.000Z')
            : null,
        }],
      });

      const deletion = await getActivePendingDeletion('tenant-1', knex);

      expect(deletion).toMatchObject({
        deletionId: `deletion-${status}`,
        status,
        reactivatable: true,
        workflowId: `workflow-${status}`,
        workflowRunId: `run-${status}`,
        subscriptionExternalId: `sub-${status}`,
      });
    }
  });

  it('T003/T053: getActivePendingDeletion filters terminal statuses and coalesces the effective deletion date', async () => {
    for (const status of ['deleting', 'deleted', 'rolled_back', 'failed']) {
      const knex = createFakeKnex({
        pending_tenant_deletions: [{
          deletion_id: `deletion-${status}`,
          tenant: 'tenant-1',
          status,
          workflow_id: `workflow-${status}`,
          scheduled_deletion_date: new Date('2026-08-01T00:00:00.000Z'),
          deletion_scheduled_for: null,
        }],
      });

      await expect(getActivePendingDeletion('tenant-1', knex)).resolves.toBeNull();
    }

    const awaitingKnex = createFakeKnex({
      pending_tenant_deletions: [{
        deletion_id: 'deletion-awaiting',
        tenant: 'tenant-1',
        status: 'awaiting_confirmation',
        workflow_id: 'workflow-awaiting',
        scheduled_deletion_date: new Date('2026-08-01T00:00:00.000Z'),
        deletion_scheduled_for: null,
      }],
    });

    await expect(getActivePendingDeletion('tenant-1', awaitingKnex)).resolves.toMatchObject({
      effectiveDeletionDate: '2026-08-01T00:00:00.000Z',
    });

    const confirmedKnex = createFakeKnex({
      pending_tenant_deletions: [{
        deletion_id: 'deletion-confirmed',
        tenant: 'tenant-1',
        status: 'confirmed',
        workflow_id: 'workflow-confirmed',
        scheduled_deletion_date: new Date('2026-08-01T00:00:00.000Z'),
        deletion_scheduled_for: new Date('2026-07-01T00:00:00.000Z'),
      }],
    });

    await expect(getActivePendingDeletion('tenant-1', confirmedKnex)).resolves.toMatchObject({
      effectiveDeletionDate: '2026-07-01T00:00:00.000Z',
    });
  });

  it('T004: getActivePendingDeletion returns null when no row exists or the EE table is absent', async () => {
    const knex = createFakeKnex({ pending_tenant_deletions: [] });
    await expect(getActivePendingDeletion('tenant-1', knex)).resolves.toBeNull();

    const missingTableKnex = (() => {
      throw Object.assign(new Error('relation "pending_tenant_deletions" does not exist'), {
        code: '42P01',
      });
    }) as any;

    await expect(getActivePendingDeletion('tenant-1', missingTableKnex)).resolves.toBeNull();
  });

  it('T005: email resolution checks tenants.email first, then internal-admin fallback', async () => {
    const tenantEmailKnex = createFakeKnex({
      tenants: [{
        tenant: 'tenant-direct',
        client_name: 'Direct Tenant',
        email: 'billing@example.com',
      }],
      users: [{
        tenant: 'tenant-other',
        email: 'billing@example.com',
        user_type: 'internal',
      }],
    });

    await expect(resolveTenantAndAdminEmailByEmail('billing@example.com', tenantEmailKnex))
      .resolves.toMatchObject({
        tenantId: 'tenant-direct',
        tenantName: 'Direct Tenant',
        adminEmail: 'billing@example.com',
        matchedBy: 'tenant_email',
      });

    const adminFallbackKnex = createFakeKnex({
      tenants: [{
        tenant: 'tenant-admin',
        client_name: 'Admin Tenant',
        email: 'tenant@example.com',
      }],
      users: [{
        tenant: 'tenant-admin',
        email: 'admin@example.com',
        user_type: 'internal',
      }],
    });

    await expect(resolveTenantAndAdminEmailByEmail('admin@example.com', adminFallbackKnex))
      .resolves.toMatchObject({
        tenantId: 'tenant-admin',
        tenantName: 'Admin Tenant',
        tenantEmail: 'tenant@example.com',
        adminEmail: 'admin@example.com',
        matchedBy: 'internal_admin',
      });
  });

  it('T077: reactivation contact resolver pins to tenants.email (the password-reset anchor)', async () => {
    // The invite/win-back recipient MUST equal the address the post-payment
    // set-password email targets (tenants.email). Pinning to one field — not a
    // fallback chain — guarantees the token and account access land in the same
    // inbox (PRD §12). Other addresses (client billing, Stripe, internal users)
    // are intentionally NOT used as fallbacks.
    const tenantEmailKnex = createFakeKnex({
      tenants: [{ tenant: 'tenant-1', email: 'tenant-owner@example.com' }],
      clients: [{ tenant: 'tenant-1', billing_email: 'billing@example.com', is_inactive: false }],
      stripe_customers: [{ tenant: 'tenant-1', email: 'stripe@example.com' }],
      users: [{ tenant: 'tenant-1', email: 'admin@example.com', user_type: 'internal' }],
    });

    await expect(resolveReactivationContactEmail('tenant-1', tenantEmailKnex))
      .resolves.toEqual({
        email: 'tenant-owner@example.com',
        source: 'tenant_email',
      });

    // When tenants.email is absent we resolve nothing (and therefore send
    // nothing) rather than diverging from the password-reset target.
    const noTenantEmailKnex = createFakeKnex({
      tenants: [{ tenant: 'tenant-1', email: null }],
      clients: [{ tenant: 'tenant-1', billing_email: 'billing@example.com', is_inactive: false }],
      stripe_customers: [{ tenant: 'tenant-1', email: 'stripe@example.com' }],
      users: [{ tenant: 'tenant-1', email: 'admin@example.com', user_type: 'internal' }],
    });

    await expect(resolveReactivationContactEmail('tenant-1', noTenantEmailKnex))
      .resolves.toBeNull();
  });
});
