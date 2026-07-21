import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(__dirname, '../../../../..');

function readRepoFile(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

describe('Microsoft polling delivery wiring', () => {
  it('adds, backfills, constrains, and rolls back the delivery-mode columns', () => {
    const migration = readRepoFile(
      'server/migrations/20260720210000_add_microsoft_email_delivery_mode.cjs'
    );

    expect(migration).toContain("table.text('delivery_mode').notNullable().defaultTo('polling')");
    expect(migration).toContain("table.timestamp('last_webhook_delivery_at', { useTz: true }).nullable()");
    expect(migration).toContain("table.integer('webhook_silent_runs').notNullable().defaultTo(0)");
    expect(migration).toContain("table.timestamp('next_subscription_probe_at', { useTz: true }).nullable()");
    expect(migration).toContain(".whereNotNull('webhook_subscription_id')");
    expect(migration).toContain(".update({ delivery_mode: 'webhook' })");
    expect(migration).toContain("CHECK (delivery_mode IN ('webhook', 'polling'))");
    expect(migration).toContain("table.dropColumn('delivery_mode')");
  });

  it('Test Connection forces a polling recovery probe without writing the ingestion cursor', () => {
    const actions = readRepoFile(
      'packages/integrations/src/actions/email-actions/emailProviderActions.ts'
    );
    const testConnectionStart = actions.indexOf('export const testEmailProviderConnection');
    const retryActionStart = actions.indexOf('export const retryMicrosoftSubscriptionRenewal');
    const testConnection = actions.slice(testConnectionStart, retryActionStart);

    expect(testConnection).toContain("vendorConfig.delivery_mode === 'polling'");
    expect(testConnection).toContain('new EmailWebhookMaintenanceService().renewMicrosoftWebhooks({');
    expect(testConnection).toContain('providerId,');
    expect(testConnection).toContain('lookAheadMinutes: 0');
    expect(testConnection).not.toContain('last_sync_at');
  });

  it('adds a dedicated reconciliation cursor and backfills it from the legacy ingestion timestamp', () => {
    const migration = readRepoFile(
      'server/migrations/20260721120000_add_microsoft_email_reconciliation_cursor.cjs'
    );

    expect(migration).toContain("table.timestamp('last_reconciliation_at', { useTz: true }).nullable()");
    expect(migration).toContain('SET last_reconciliation_at = ep.last_sync_at');
    expect(migration).toContain('mpc.tenant = ep.tenant');
    expect(migration).toContain("table.dropColumn('last_reconciliation_at')");
  });

  it('registers a config-backed three-minute non-overlapping Temporal schedule', () => {
    const schedules = readRepoFile(
      'ee/temporal-workflows/src/schedules/setupSchedules.ts'
    );

    expect(schedules).toContain("const pollingScheduleId = 'email-polling-reconcile-schedule'");
    expect(schedules).toContain('process.env.MICROSOFT_EMAIL_POLLING_INTERVAL_MINUTES || 3');
    expect(schedules).toContain('ScheduleOverlapPolicy.SKIP');
  });
});
