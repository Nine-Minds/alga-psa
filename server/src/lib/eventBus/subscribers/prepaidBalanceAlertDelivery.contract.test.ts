import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const source = readFileSync(resolve(__dirname, 'prepaidBalanceAlertDelivery.ts'), 'utf8');

describe('prepaid balance alert delivery wiring contract', () => {
  it('claims deliveries atomically inside one transaction (FOR UPDATE SKIP LOCKED held to commit)', () => {
    expect(source).toContain('return knex.transaction(async (trx) => {');
    const claimBlock = source.slice(source.indexOf('async function claimDeliveries'), source.indexOf('function rolesOf'));
    expect(claimBlock).toContain('.forUpdate()');
    expect(claimBlock).toContain('.skipLocked()');
    expect(claimBlock).toContain('.where({ tenant: tenantId, delivery_id: row.delivery_id })');
  });

  it('excludes resolved alerts from the claim predicate inside the same transaction', () => {
    const claimBlock = source.slice(source.indexOf('async function claimDeliveries'), source.indexOf('function rolesOf'));
    expect(claimBlock).toContain(".whereNull('a.resolved_at')");
  });

  it('terminalizes pending/retrying sends of resolved alerts as superseded inside the claim transaction', () => {
    const claimBlock = source.slice(source.indexOf('async function claimDeliveries'), source.indexOf('function rolesOf'));
    expect(claimBlock).toContain('DELIVERY_STATUS_SUPERSEDED');
    expect(claimBlock).toContain("whereIn('alert_id', db.table('prepaid_balance_alerts').whereNotNull('resolved_at').select('alert_id'))");
    expect(claimBlock).toContain("status: DELIVERY_STATUS_SUPERSEDED");
    expect(claimBlock).toContain('summary.superseded');
    // The claim still runs in the same atomic transaction (no auto-commit split).
    expect(claimBlock).toContain('.forUpdate()');
    expect(claimBlock).toContain('.skipLocked()');
  });

  it('revalidates the parent and current recipient authorization before side effects', () => {
    const processBlock = source.slice(source.indexOf('async function processDelivery'));
    expect(processBlock).toContain('authorizedRolesForClaim');
    expect(processBlock).toContain('claimedAlertIsOpen');
    expect(processBlock).toContain('supersedeClaimedDelivery');
    expect(processBlock).toContain('worker_id: delivery.worker_id');
  });

  it('evaluates collapsed-address preferences per role and can select the client route', () => {
    const roleBlock = source.slice(source.indexOf('async function resolveEmailRoles'), source.indexOf('function subtypeAndTemplateFor'));
    expect(roleBlock).toContain('delivery.recipient_user_id');
    expect(roleBlock).toContain('emailPreferencesEnabled(knex, tenantId, subtypeName)');
    expect(roleBlock).toContain('RECIPIENT_ROLE_CLIENT_BILLING');
    const processBlock = source.slice(source.indexOf('async function processDelivery'));
    expect(processBlock).toContain('recipientClientId: prepared.isManager ? undefined : delivery.alert.client_id');
    expect(processBlock).toContain('clientAlertLink()');
  });

  it('drains distinct claim batches without reclaiming IDs attempted in the same run', () => {
    const drainBlock = source.slice(source.indexOf('export async function planAndDrainDeliveriesForTenant'));
    expect(drainBlock).toContain('while (true)');
    expect(drainBlock).toContain('attemptedDeliveryIds.add(delivery.delivery_id)');
    expect(source).toContain("query.whereNotIn('d.delivery_id', [...attemptedDeliveryIds])");
  });

  it('applies the tenant predicate to every delivery-status update, including the internal-channel transaction', () => {
    const internalBlock = source.slice(source.indexOf('if (delivery.channel === DELIVERY_CHANNEL_INTERNAL)'));
    expect(internalBlock).toContain('const db = tenantDb(trx, tenantId);');
    expect(internalBlock).toContain(".table('prepaid_balance_alert_deliveries')");
    expect(internalBlock).toContain('tenant: tenantId,');
    expect(internalBlock).toContain('delivery_id: delivery.delivery_id,');
    // No bare trx(...) updates that bypass the tenant-scoped facade.
    expect(internalBlock).not.toMatch(/trx\(['"]prepaid_balance_alert_deliveries['"]\)/);
  });

  it('passes a flat internal context so the internal renderer can substitute every placeholder', () => {
    expect(source).toContain('buildInternalAlertContext(alert.client_name, {');
    const internalBlock = source.slice(source.indexOf('if (delivery.channel === DELIVERY_CHANNEL_INTERNAL)'));
    expect(internalBlock).toContain('const data = buildInternalAlertContextForDelivery(delivery.alert, locale, link);');
  });

  it('isolates per-alert planning failures from the rest of the tenant drain', () => {
    expect(source).toContain('await planDeliveriesForAlert(knex, tenantId, alert, summary);');
    expect(source).toContain('catch (error) {');
  });

  it('unions recipient_roles on upsert instead of overwriting', () => {
    expect(source).toContain("recipient_roles: knex.raw('prepaid_balance_alert_deliveries.recipient_roles || excluded.recipient_roles')");
  });
});
