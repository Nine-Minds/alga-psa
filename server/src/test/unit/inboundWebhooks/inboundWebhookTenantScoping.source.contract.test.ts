import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(__dirname, '../../../../../');

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

describe('inbound webhook tenant scoping source contracts', () => {
  it('T190: all inbound webhook config roots use tenantDb', () => {
    const actionSource = readSource('server/src/lib/actions/inboundWebhookActions.ts');
    const lookupSource = readSource('server/src/lib/inboundWebhooks/configLookup.ts');

    expect(actionSource).toContain("import { createTenantKnex, tenantDb } from '@alga-psa/db';");
    expect(actionSource).toContain('const db = tenantDb(knex, tenant);');
    expect(actionSource).toContain("db.table<InboundWebhookRow>('inbound_webhooks')");
    expect(actionSource).toContain('insert({\n            tenant,');
    expect(lookupSource).toContain("import { tenantDb } from '@alga-psa/db';");
    expect(lookupSource).toContain("tenantDb(knex, tenant).table<InboundWebhookConfigLookupRow>('inbound_webhooks')");

    expect(actionSource).not.toMatch(/\bknex(?:<[^>]+>)?\(['"]inbound_webhooks['"]\)/);
    expect(lookupSource).not.toMatch(/\bknex(?:<[^>]+>)?\(['"]inbound_webhooks['"]\)/);
  });

  it('T191: all inbound delivery roots use tenantDb', () => {
    const actionSource = readSource('server/src/lib/actions/inboundWebhookActions.ts');
    const persistenceSource = readSource('server/src/lib/inboundWebhooks/deliveryPersistence.ts');
    const idempotencySource = readSource('server/src/lib/inboundWebhooks/idempotency.ts');

    expect(actionSource).toContain("db.table<InboundWebhookDeliveryRow>('inbound_webhook_deliveries')");
    expect(actionSource).toContain("db.table('inbound_webhook_deliveries')");
    expect(actionSource).toContain("tenantDb(knex, tenant).table<InboundWebhookDeliveryRow>('inbound_webhook_deliveries')");
    expect(persistenceSource).toContain("tenantDb(knex, input.tenant).table('inbound_webhook_deliveries')");
    expect(persistenceSource).toContain('insert({\n      tenant: input.tenant,');
    expect(idempotencySource).toContain("tenantDb(args.knex, args.tenant).table('inbound_webhook_deliveries')");

    for (const source of [actionSource, persistenceSource, idempotencySource]) {
      expect(source).not.toMatch(/\b(?:args\.)?knex(?:<[^>]+>)?\(['"]inbound_webhook_deliveries['"]\)/);
    }
  });
});
