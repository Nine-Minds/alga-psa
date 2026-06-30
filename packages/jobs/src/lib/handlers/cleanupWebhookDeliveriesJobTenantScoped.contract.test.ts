import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const source = readFileSync(resolve(__dirname, 'cleanupWebhookDeliveriesJob.ts'), 'utf8');

describe('cleanup webhook deliveries job tenant facade contract', () => {
  it('uses an explicit unscoped maintenance boundary for all-tenant retention cleanup', () => {
    expect(source).toContain("tenantDb(knex, WEBHOOK_DELIVERY_CLEANUP_TENANT)");
    expect(source).toContain(".unscoped('webhook_deliveries', WEBHOOK_DELIVERY_CLEANUP_REASON)");
    expect(source).toContain(".unscoped('webhook_deliveries as wd', WEBHOOK_DELIVERY_CLEANUP_REASON)");
    expect(source).toContain('webhook delivery retention cleanup scans expired deliveries across tenants');
    expect(source).toContain(".with('doomed', doomedDeliveries)");
    expect(source).toContain(".using(['doomed'])");
    expect(source).toContain(".where('wd.tenant', knex.ref('doomed.tenant'))");
    expect(source).not.toContain(".from('webhook_deliveries as wd')");
    expect(source).not.toContain('FROM webhook_deliveries');
    expect(source).not.toContain('DELETE FROM webhook_deliveries');
    expect(source).not.toContain('const result = await knex.raw');
  });
});
