import path from 'node:path';
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

function readRepoFile(relativePathFromRepoRoot: string): string {
  const repoRoot = path.resolve(__dirname, '../../../../..');
  return readFileSync(path.join(repoRoot, relativePathFromRepoRoot), 'utf8');
}

describe('tenant reactivation win-back migration', () => {
  const migration = readRepoFile(
    'ee/server/migrations/20260605120000_add_tenant_reactivation_winback_tables.cjs',
  );

  it('T001: adds nullable last_winback_email_at with idempotent up/down guards', () => {
    expect(migration).toContain("hasTable('pending_tenant_deletions')");
    expect(migration).toContain("hasColumn(\n      'pending_tenant_deletions',\n      'last_winback_email_at'");
    expect(migration).toContain("alterTable('pending_tenant_deletions'");
    expect(migration).toContain("table.timestamp('last_winback_email_at').nullable()");
    expect(migration).toContain("table.dropColumn('last_winback_email_at')");
  });

  it('T060: creates the pending reactivation refunds ledger and open queue indexes idempotently', () => {
    expect(migration).toContain("hasTable('pending_reactivation_refunds')");
    expect(migration).toContain("createTable('pending_reactivation_refunds'");
    expect(migration).toContain("table.uuid('tenant').notNullable().references('tenant').inTable('tenants')");
    expect(migration).toContain("table.text('stripe_checkout_session_id').notNullable()");
    expect(migration).toContain("table.text('stripe_payment_intent_id').nullable()");
    expect(migration).toContain("table.text('stripe_subscription_external_id').nullable()");
    expect(migration).toContain("table.text('reason').notNullable()");
    expect(migration).toContain("table.timestamp('created_at').notNullable().defaultTo(knex.fn.now())");
    expect(migration).toContain("table.timestamp('resolved_at').nullable()");
    expect(migration).toContain('pending_reactivation_refunds_resolved_at_idx');
    expect(migration).toContain('CREATE INDEX IF NOT EXISTS pending_reactivation_refunds_open_queue_idx');
    expect(migration).toContain('WHERE resolved_at IS NULL');
    expect(migration).toContain("dropTableIfExists('pending_reactivation_refunds')");
  });

  it('T068: creates the durable single-use token ledger with uniqueness and reservation indexes', () => {
    expect(migration).toContain("hasTable('tenant_reactivation_tokens')");
    expect(migration).toContain("createTable('tenant_reactivation_tokens'");
    expect(migration).toContain("table.uuid('tenant').notNullable().references('tenant').inTable('tenants')");
    expect(migration).toContain("table.uuid('deletion_id').notNullable()");
    expect(migration).toContain("table.text('token_hash').notNullable()");
    expect(migration).toContain("table.timestamp('expires_at').notNullable()");
    expect(migration).toContain("table.timestamp('reserved_at').nullable()");
    expect(migration).toContain("table.timestamp('consumed_at').nullable()");
    expect(migration).toContain("table.text('checkout_session_id').nullable()");
    expect(migration).toContain("table.timestamp('created_at').notNullable().defaultTo(knex.fn.now())");
    expect(migration).toContain("table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now())");
    expect(migration).toContain("table.unique(['tenant', 'token_hash']");
    expect(migration).toContain('tenant_reactivation_tokens_tenant_deletion_idx');
    expect(migration).toContain('CREATE INDEX IF NOT EXISTS tenant_reactivation_tokens_open_unexpired_idx');
    expect(migration).toContain('WHERE reserved_at IS NULL AND consumed_at IS NULL');
    expect(migration).toContain("dropTableIfExists('tenant_reactivation_tokens')");
  });

  it('T068b: distributes both tenant tables by tenant (Citus), with distribution-column-led keys', () => {
    // create_distributed_table requires the distribution column in every PK /
    // unique constraint, so both PKs lead with `tenant` and the token ledger is
    // unique on (tenant, token_hash).
    expect(migration).toContain("table.primary(['tenant', 'refund_id']");
    expect(migration).toContain("table.primary(['tenant', 'reactivation_token_id']");
    expect(migration).toContain("create_distributed_table('${table}', 'tenant', colocate_with => 'tenants')");
    expect(migration).toContain("distributeTenantTable(knex, 'pending_reactivation_refunds')");
    expect(migration).toContain("distributeTenantTable(knex, 'tenant_reactivation_tokens')");
    // create_distributed_table cannot run inside a transaction.
    expect(migration).toContain('exports.config = { transaction: false }');
    // Distribution is guarded so non-Citus (local/dev) deploys still work.
    expect(migration).toContain("pg_extension WHERE extname = 'citus'");
  });
});
