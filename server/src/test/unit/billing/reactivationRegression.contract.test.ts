import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

import {
  getActivePendingDeletion,
  getPendingDeletionSummary,
} from '../../../../../ee/server/src/lib/billing/tenantReactivationDetection';
import {
  buildReactivationInviteEmail,
} from '../../../../../ee/server/src/lib/billing/reactivationInviteEmail';

const root = path.resolve(__dirname, '../../../../..');

type Row = Record<string, any>;

function read(relativePath: string): string {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function section(source: string, start: string, end: string): string {
  const startIndex = source.indexOf(start);
  expect(startIndex).toBeGreaterThan(-1);
  const endIndex = source.indexOf(end, startIndex + start.length);
  expect(endIndex).toBeGreaterThan(startIndex);
  return source.slice(startIndex, endIndex);
}

function createFakeKnex(tables: Record<string, Row[]>) {
  return ((tableName: string) => {
    let rows = [...(tables[tableName] ?? [])];
    const columnName = (key: string) => key.includes('.') ? key.split('.').pop()! : key;

    const builder = {
      where(criteria: string | Row, value?: unknown) {
        if (typeof criteria === 'string') {
          rows = rows.filter((row) => row[columnName(criteria)] === value);
        } else {
          rows = rows.filter((row) =>
            Object.entries(criteria).every(([key, expected]) => row[columnName(key)] === expected),
          );
        }
        return builder;
      },
      first(...columns: string[]) {
        const row = rows[0];
        if (!row || columns.length === 0) {
          return Promise.resolve(row);
        }
        return Promise.resolve(Object.fromEntries(columns.map((column) => [column, row[column]])));
      },
    };

    return builder;
  }) as any;
}

function pendingDeletion(status: string, overrides: Row = {}): Row {
  return {
    deletion_id: `deletion-${status}`,
    tenant: 'tenant-1',
    status,
    workflow_id: `workflow-${status}`,
    workflow_run_id: `run-${status}`,
    subscription_external_id: `sub-old-${status}`,
    confirmation_type: null,
    scheduled_deletion_date: new Date('2026-08-01T12:00:00.000Z'),
    deletion_scheduled_for: null,
    ...overrides,
  };
}

describe('tenant reactivation regression contract', () => {
  it('T047/T048: paid reactivation restores the existing tenant path and never creates a tenant row', () => {
    const workflow = read('ee/temporal-workflows/src/workflows/tenant-deletion-workflow.ts');
    const activities = read('ee/temporal-workflows/src/activities/tenant-deletion-activities.ts');
    const tenantOps = read('ee/temporal-workflows/src/db/tenant-operations.ts');

    const rollback = section(workflow, 'async function handleRollback(', '  // Update database');
    expect(rollback).toContain('await reactivateTenantUsers(tenantId)');
    expect(rollback).toContain('await reactivateMasterTenantClient(tenantId)');
    expect(rollback).toContain('await linkSubscriptionToExistingTenant({');
    expect(rollback).toContain('await triggerReactivationPasswordReset({ tenantId })');

    const linkActivity = section(
      activities,
      'export async function linkSubscriptionToExistingTenant(',
      'export async function stampReactivationSubscriptionMetadata',
    );
    expect(linkActivity).toContain("knex('stripe_subscriptions')");
    expect(linkActivity).toContain("trx('stripe_customers')");
    expect(linkActivity).toContain('insertStripeSubscriptionForTenant(trx');
    expect(linkActivity).not.toContain("trx('tenants')");
    expect(linkActivity).not.toContain("knex('tenants')");

    const subscriptionHelper = section(
      tenantOps,
      'export async function insertStripeSubscriptionForTenant(',
      '/**\n * Create a new tenant',
    );
    expect(subscriptionHelper).toContain("await tenantDb(trx, input.tenantId).table('stripe_subscriptions')");
    expect(subscriptionHelper).toContain('tenant: input.tenantId');
    expect(subscriptionHelper).toContain('stripe_customer_id: input.stripeCustomerInternalId');
    expect(subscriptionHelper).not.toContain("trx('tenants')");
    expect(subscriptionHelper).not.toContain("trx('stripe_customers')");
  });

  it('T050/T054: terminal or immediate-edge deletion states are refused as past-window reactivations', async () => {
    for (const status of ['deleting', 'deleted']) {
      const knex = createFakeKnex({
        pending_tenant_deletions: [pendingDeletion(status)],
      });

      await expect(getActivePendingDeletion('tenant-1', knex)).resolves.toBeNull();
      await expect(getPendingDeletionSummary('tenant-1', knex)).resolves.toMatchObject({
        status,
        reactivatable: false,
      });
    }

    const route = read('ee/server/src/app/api/billing/complete-reactivation/route.ts');
    expect(route).toContain('if (!pendingDeletion?.reactivatable)');
    expect(route).toContain("'past_window'");
    expect(route).toContain('status: 409');
    expect(route).toContain("tenantDb(knex, input.tenantId).table('pending_reactivation_refunds').insert");
  });

  it('T052/T053: confirmed deletions remain reactivatable and display the effective deletion date', async () => {
    const confirmedKnex = createFakeKnex({
      pending_tenant_deletions: [
        pendingDeletion('confirmed', {
          confirmation_type: '30_days',
          scheduled_deletion_date: new Date('2026-08-01T12:00:00.000Z'),
          deletion_scheduled_for: new Date('2026-07-01T12:00:00.000Z'),
        }),
      ],
    });

    const confirmed = await getActivePendingDeletion('tenant-1', confirmedKnex);
    expect(confirmed).toMatchObject({
      status: 'confirmed',
      reactivatable: true,
      effectiveDeletionDate: '2026-07-01T12:00:00.000Z',
      confirmationType: '30_days',
    });

    const awaitingKnex = createFakeKnex({
      pending_tenant_deletions: [pendingDeletion('awaiting_confirmation')],
    });
    await expect(getActivePendingDeletion('tenant-1', awaitingKnex)).resolves.toMatchObject({
      effectiveDeletionDate: '2026-08-01T12:00:00.000Z',
    });

    const email = buildReactivationInviteEmail({
      to: 'admin@example.com',
      tenantId: 'tenant-1',
      tenantName: 'Acme MSP',
      reactivationUrl: 'https://store.example.test/reactivate?token=signed',
      effectiveDeletionDate: confirmed!.effectiveDeletionDate,
    });
    expect(email.html).toContain('July 1, 2026');

    const workflow = read('ee/temporal-workflows/src/workflows/tenant-deletion-workflow.ts');
    const confirmedIndex = workflow.indexOf("status: 'confirmed'");
    const rollbackWaitIndex = workflow.indexOf('await condition(\n        () => rollbackSignal !== null,\n        deletionDelay');
    const deletingIndex = workflow.indexOf("status: 'deleting'", rollbackWaitIndex);
    expect(confirmedIndex).toBeGreaterThan(-1);
    expect(rollbackWaitIndex).toBeGreaterThan(confirmedIndex);
    expect(deletingIndex).toBeGreaterThan(rollbackWaitIndex);
  });
});
