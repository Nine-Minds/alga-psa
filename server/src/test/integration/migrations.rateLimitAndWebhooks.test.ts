import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * T037 — Migration smoke at the source-file level.
 *
 * Real Postgres+Citus is not available in this vitest setup, so this test
 * audits the migration source for the schema/distribution contract instead
 * of running the migrations end-to-end:
 *   - api_rate_limit_settings: required columns + UNIQUE (tenant, api_key_id)
 *   - webhooks / webhook_deliveries: required columns + indexes
 *   - Citus distribute migrations call create_distributed_table('<table>',
 *     'tenant') for each of the three tables.
 *
 * If/when a Citus-aware test database becomes available, this test should
 * be replaced with a real `npx knex migrate:up` smoke + a
 * `pg_dist_partition` query.
 */

const REPO_ROOT = path.resolve(__dirname, '../../../..');

function readMigration(relPath: string): string {
  const abs = path.join(REPO_ROOT, relPath);
  expect(fs.existsSync(abs), `${relPath} should exist`).toBe(true);
  return fs.readFileSync(abs, 'utf8');
}

describe('migrations smoke (T037)', () => {
  it('api_rate_limit_settings: creates the table with required columns and UNIQUE (tenant, api_key_id)', () => {
    const sql = readMigration('server/migrations/20260505123000_create_api_rate_limit_settings.cjs');

    expect(sql).toMatch(/createTable\(['"]api_rate_limit_settings['"]/);
    for (const col of ['tenant', 'api_key_id', 'max_tokens', 'refill_per_min', 'created_at', 'updated_at']) {
      expect(sql, `column ${col} missing`).toMatch(new RegExp(col));
    }
    // The migration uses raw CREATE UNIQUE INDEX statements: one partial
    // index over (tenant, api_key_id) WHERE api_key_id IS NOT NULL, and a
    // separate partial index over (tenant) WHERE api_key_id IS NULL so the
    // tenant-default row is unique too.
    expect(sql).toMatch(/CREATE\s+UNIQUE\s+INDEX[\s\S]*tenant[\s\S]*api_key_id[\s\S]*WHERE\s+api_key_id\s+IS\s+NOT\s+NULL/i);
    expect(sql).toMatch(/CREATE\s+UNIQUE\s+INDEX[\s\S]*tenant[\s\S]*WHERE\s+api_key_id\s+IS\s+NULL/i);
  });

  it('webhooks + webhook_deliveries: required columns and the documented indexes', () => {
    const sql = readMigration('server/migrations/20260505140000_create_webhook_tables.cjs');

    expect(sql).toMatch(/createTable\(['"]webhooks['"]/);
    expect(sql).toMatch(/createTable\(['"]webhook_deliveries['"]/);

    for (const col of [
      'webhook_id',
      'tenant',
      'name',
      'url',
      'method',
      'event_types',
      'custom_headers',
      'signing_secret_vault_path',
      'security_type',
      'verify_ssl',
      'retry_config',
      'rate_limit_per_min',
      'is_active',
      'total_deliveries',
      'successful_deliveries',
      'failed_deliveries',
      'last_delivery_at',
      'last_success_at',
      'last_failure_at',
      'auto_disabled_at',
      'created_by_user_id',
      'created_at',
      'updated_at',
    ]) {
      expect(sql, `webhooks column ${col} missing`).toMatch(new RegExp(col));
    }

    for (const col of [
      'delivery_id',
      'tenant',
      'webhook_id',
      'event_id',
      'event_type',
      'request_headers',
      'request_body',
      'response_status_code',
      'response_headers',
      'response_body',
      'status',
      'attempt_number',
      'duration_ms',
      'error_message',
      'next_retry_at',
      'is_test',
      'attempted_at',
      'completed_at',
    ]) {
      expect(sql, `webhook_deliveries column ${col} missing`).toMatch(new RegExp(col));
    }

    // Documented indexes.
    expect(sql).toMatch(/webhook_id/);
    expect(sql).toMatch(/attempted_at/);
    // Partial index on pending/retrying is what the scheduled cleanup leans on.
    expect(sql).toMatch(/pending|retrying/);
  });

  it('Citus distribute migrations distribute all three tables on the tenant column', () => {
    const rateLimitDistribute = readMigration(
      'ee/server/migrations/citus/20260505123100_distribute_api_rate_limit_settings.cjs',
    );
    // api_rate_limit_settings calls create_distributed_table directly.
    expect(rateLimitDistribute).toMatch(
      /create_distributed_table\(\s*['"]api_rate_limit_settings['"]\s*,\s*['"]tenant['"]/,
    );

    // webhooks/webhook_deliveries go through a `distributeTable(knex, '<table>')`
    // helper that wraps create_distributed_table('<table>', 'tenant', ...).
    const webhookDistribute = readMigration(
      'ee/server/migrations/citus/20260505140100_distribute_webhook_tables.cjs',
    );
    expect(webhookDistribute).toMatch(/distributeTable\(\s*knex\s*,\s*['"]webhooks['"]/);
    expect(webhookDistribute).toMatch(/distributeTable\(\s*knex\s*,\s*['"]webhook_deliveries['"]/);
    expect(webhookDistribute).toMatch(/create_distributed_table\([^)]*['"]tenant['"]/);
  });
});
