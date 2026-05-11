import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(__dirname, '../../../../..');

function readMigration(fileName: string): string {
  return fs.readFileSync(path.join(repoRoot, 'server', 'migrations', fileName), 'utf8');
}

describe('inbound webhook migrations', () => {
  const inboundWebhooksMigration = readMigration('20260511100000_create_inbound_webhooks_table.cjs');

  it('T001: creates inbound_webhooks with tenant in the composite primary key and Citus distribution key', () => {
    expect(inboundWebhooksMigration).toContain("createTable('inbound_webhooks'");
    expect(inboundWebhooksMigration).toContain("table.uuid('tenant').notNullable().references('tenant').inTable('tenants')");
    expect(inboundWebhooksMigration).toContain("table.uuid('inbound_webhook_id')");
    expect(inboundWebhooksMigration).toContain("table.primary(['tenant', 'inbound_webhook_id'])");
    expect(inboundWebhooksMigration).toContain("table.unique(['tenant', 'slug']");
    expect(inboundWebhooksMigration).toContain("table.index(['tenant', 'is_active']");
    expect(inboundWebhooksMigration).toContain("create_distributed_table('inbound_webhooks', 'tenant'");
  });
});
