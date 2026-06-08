import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

const root = path.resolve(__dirname, '../../../../..');

function read(relativePath: string): string {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

describe('reactivation core contract', () => {
  it('T027/T051: rollbackDeletion supports optional reactivation block while admin rollback stays unchanged', () => {
    const types = read('ee/temporal-workflows/src/types/tenant-deletion-types.ts');
    const adminRoute = read('ee/server/src/app/api/v1/tenant-management/rollback-deletion/route.ts');

    expect(types).toContain('reactivation?: TenantReactivationRollbackInput');
    expect(types).toContain('stripeCustomerId: string');
    expect(types).toContain('stripeSubscriptionId: string');
    expect(types).toContain('sendPasswordReset?: boolean');
    expect(adminRoute).toContain('rollbackTenantDeletion(');
    expect(adminRoute).not.toContain('reactivation:');
  });

  it('T028/T029/T032/T033: workflow reactivates users/client before password reset', () => {
    const workflow = read('ee/temporal-workflows/src/workflows/tenant-deletion-workflow.ts');

    const usersIndex = workflow.indexOf('await reactivateTenantUsers(tenantId)');
    const clientIndex = workflow.indexOf('await reactivateMasterTenantClient(tenantId)');
    const linkIndex = workflow.indexOf('await linkSubscriptionToExistingTenant');
    const resetIndex = workflow.indexOf('await triggerReactivationPasswordReset');

    expect(usersIndex).toBeGreaterThan(-1);
    expect(clientIndex).toBeGreaterThan(usersIndex);
    expect(linkIndex).toBeGreaterThan(clientIndex);
    expect(resetIndex).toBeGreaterThan(linkIndex);
  });

  it('T030/T031/T034/T057/T062/T075: subscription link reuses an existing customer and tenant-keyed active-sub guard', () => {
    const activities = read('ee/temporal-workflows/src/activities/tenant-deletion-activities.ts');
    const tenantOps = read('ee/temporal-workflows/src/db/tenant-operations.ts');

    expect(activities).toContain('existingActiveSubscription');
    expect(activities).toContain(".whereIn('status', ['active', 'trialing'])");
    expect(activities).toContain("trx('stripe_customers')");
    expect(activities).toContain('insertStripeSubscriptionForTenant(trx');
    expect(tenantOps).toContain('export async function insertStripeSubscriptionForTenant');
    expect(tenantOps).toContain('stripe_customer_id: input.stripeCustomerInternalId');
    expect(tenantOps).toContain('billing_tenant: MASTER_TENANT_ID');
  });

  it('T055/T056/T063/T074: refused or failed paid reactivation writes refund ledger and sends ops email', () => {
    const route = read('ee/server/src/app/api/billing/complete-reactivation/route.ts');
    const activities = read('ee/temporal-workflows/src/activities/tenant-deletion-activities.ts');
    const workflow = read('ee/temporal-workflows/src/workflows/tenant-deletion-workflow.ts');

    expect(route).toContain("knex('pending_reactivation_refunds').insert");
    expect(route).toContain('getSystemEmailService');
    expect(route).toContain("'past_window'");
    expect(route).toContain("'duplicate_payment'");
    expect(activities).toContain("knex('pending_reactivation_refunds').insert");
    expect(read('ee/temporal-workflows/src/types/tenant-deletion-types.ts')).toContain("'reactivated_unbilled'");
    expect(workflow).toContain("reason: 'reactivated_unbilled'");
  });

  it('T032/T035: app-side password-reset endpoint runs requestPasswordReset and worker calls it', () => {
    const route = read('ee/server/src/app/api/billing/reactivation-password-reset/route.ts');
    const activities = read('ee/temporal-workflows/src/activities/tenant-deletion-activities.ts');

    expect(route).toContain("requestPasswordReset(email, 'internal')");
    expect(activities).toContain('/api/billing/reactivation-password-reset');
    expect(activities).toContain('X-Webhook-Signature');
  });

  it('password-reset failures are surfaced, not swallowed (retry then ops alert without faking success)', () => {
    const activities = read('ee/temporal-workflows/src/activities/tenant-deletion-activities.ts');
    const workflow = read('ee/temporal-workflows/src/workflows/tenant-deletion-workflow.ts');

    // The activity throws on a non-2xx so Temporal retries instead of returning
    // a swallowed { success: false }.
    expect(activities).toContain('if (!response.ok) {');
    expect(activities).toContain('Reactivation password reset request failed');

    // A link failure is reactivated_unbilled (refund-eligible); a post-link
    // password-reset failure is reactivated_no_access (billed + reactivated but
    // locked out — manual reset, NOT a refund) and must NOT fail the rollback.
    expect(workflow).toContain("reason: 'reactivated_unbilled'");
    expect(workflow).toContain("reason: 'reactivated_no_access'");
    const noAccessIndex = workflow.indexOf("reason: 'reactivated_no_access'");
    const resetIndex = workflow.indexOf('await triggerReactivationPasswordReset');
    expect(noAccessIndex).toBeGreaterThan(resetIndex);
  });

  it('T064b: every reactivation HMAC endpoint enforces a 5-minute timestamp freshness window', () => {
    const routes = [
      'ee/server/src/app/api/billing/check-tenant/route.ts',
      'ee/server/src/app/api/billing/request-reactivation/route.ts',
      'ee/server/src/app/api/billing/complete-reactivation/route.ts',
      'ee/server/src/app/api/billing/reactivation-token/route.ts',
      'ee/server/src/app/api/billing/reactivation-token/session/route.ts',
      'ee/server/src/app/api/billing/reactivation-password-reset/route.ts',
      'packages/ee/src/app/api/billing/check-tenant/route.ts',
    ];

    for (const route of routes) {
      expect(read(route)).toContain('Math.abs(Date.now() - timestampMs) > 5 * 60 * 1000');
    }
  });
});
