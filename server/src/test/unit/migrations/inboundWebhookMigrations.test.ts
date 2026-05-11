import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(__dirname, '../../../../..');

function readMigration(fileName: string): string {
  return fs.readFileSync(path.join(repoRoot, 'server', 'migrations', fileName), 'utf8');
}

describe('inbound webhook migrations', () => {
  const inboundWebhooksMigration = readMigration('20260511100000_create_inbound_webhooks_table.cjs');
  const deliveriesMigration = readMigration('20260511101000_create_inbound_webhook_deliveries_table.cjs');

  it('T001: creates inbound_webhooks with tenant in the composite primary key and Citus distribution key', () => {
    expect(inboundWebhooksMigration).toContain("createTable('inbound_webhooks'");
    expect(inboundWebhooksMigration).toContain("table.uuid('tenant').notNullable().references('tenant').inTable('tenants')");
    expect(inboundWebhooksMigration).toContain("table.uuid('inbound_webhook_id')");
    expect(inboundWebhooksMigration).toContain("table.primary(['tenant', 'inbound_webhook_id'])");
    expect(inboundWebhooksMigration).toContain("table.unique(['tenant', 'slug']");
    expect(inboundWebhooksMigration).toContain("table.index(['tenant', 'is_active']");
    expect(inboundWebhooksMigration).toContain("create_distributed_table('inbound_webhooks', 'tenant'");
  });

  it('T002: creates inbound_webhook_deliveries with tenant in the composite primary key and tenant-scoped links', () => {
    expect(deliveriesMigration).toContain("createTable('inbound_webhook_deliveries'");
    expect(deliveriesMigration).toContain("table.uuid('tenant').notNullable().references('tenant').inTable('tenants')");
    expect(deliveriesMigration).toContain("table.uuid('delivery_id')");
    expect(deliveriesMigration).toContain("table.primary(['tenant', 'delivery_id'])");
    expect(deliveriesMigration).toContain(".foreign(['tenant', 'inbound_webhook_id'])");
    expect(deliveriesMigration).toContain(".references(['tenant', 'inbound_webhook_id'])");
    expect(deliveriesMigration).toContain(".foreign(['tenant', 'replayed_from'])");
    expect(deliveriesMigration).toContain(".references(['tenant', 'delivery_id'])");
    expect(deliveriesMigration).toContain('inbound_webhook_deliveries_idempotency_idx');
    expect(deliveriesMigration).toContain("ON inbound_webhook_deliveries (tenant, inbound_webhook_id, idempotency_key");
    expect(deliveriesMigration).toContain("create_distributed_table('inbound_webhook_deliveries', 'tenant'");
  });

  it('T003: enforces inbound webhook slug uniqueness per tenant, not globally', () => {
    expect(inboundWebhooksMigration).toContain(
      "table.unique(['tenant', 'slug'], { indexName: 'inbound_webhooks_tenant_slug_unique' })",
    );
    expect(inboundWebhooksMigration).not.toContain("table.unique(['slug']");
    expect(inboundWebhooksMigration).not.toContain('UNIQUE (slug)');
  });

  it('T005: inbound webhook migrations are idempotent when re-run', () => {
    expect(inboundWebhooksMigration).toContain("await knex.schema.hasTable('inbound_webhooks')");
    expect(inboundWebhooksMigration).toContain('if (!tableExists) {');
    expect(inboundWebhooksMigration).toContain('FROM pg_dist_partition');
    expect(inboundWebhooksMigration).toContain('if (!alreadyDistributed.rows?.[0]?.is_distributed)');
    expect(inboundWebhooksMigration).toContain("dropTableIfExists('inbound_webhooks')");

    expect(deliveriesMigration).toContain("await knex.schema.hasTable('inbound_webhook_deliveries')");
    expect(deliveriesMigration).toContain('if (!tableExists) {');
    expect(deliveriesMigration).toContain('CREATE INDEX IF NOT EXISTS inbound_webhook_deliveries_webhook_received_idx');
    expect(deliveriesMigration).toContain('CREATE INDEX IF NOT EXISTS inbound_webhook_deliveries_status_received_idx');
    expect(deliveriesMigration).toContain('CREATE INDEX IF NOT EXISTS inbound_webhook_deliveries_idempotency_idx');
    expect(deliveriesMigration).toContain('CREATE INDEX IF NOT EXISTS inbound_webhook_deliveries_replay_idx');
    expect(deliveriesMigration).toContain('FROM pg_dist_partition');
    expect(deliveriesMigration).toContain('if (!alreadyDistributed.rows?.[0]?.is_distributed)');
    expect(deliveriesMigration).toContain("dropTableIfExists('inbound_webhook_deliveries')");
  });
});
