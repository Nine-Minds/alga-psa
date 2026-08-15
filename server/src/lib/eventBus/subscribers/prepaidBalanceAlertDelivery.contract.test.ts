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

  it('applies the tenant predicate to every delivery-status update, including the internal-channel transaction', () => {
    const internalBlock = source.slice(source.indexOf('if (delivery.channel === DELIVERY_CHANNEL_INTERNAL)'));
    expect(internalBlock).toContain('const db = tenantDb(trx, tenantId);');
    expect(internalBlock).toContain(".table('prepaid_balance_alert_deliveries')");
    expect(internalBlock).toContain('.where({ tenant: tenantId, delivery_id: delivery.delivery_id })');
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
