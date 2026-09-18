import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationPath = path.resolve(
  __dirname,
  '../../../../../server/migrations/20260913120000_create_external_entity_links.cjs'
);

function readMigration(): string {
  return fs.readFileSync(migrationPath, 'utf8');
}

describe('external entity links migration contract', () => {
  it('T110: creates both tenant-scoped tables with composite primary keys', () => {
    const migration = readMigration();

    expect(migration).toContain("hasTable('tenant_external_systems')");
    expect(migration).toContain("hasTable('external_entity_links')");
    expect(migration).toContain("table.primary(['tenant', 'key'])");
    expect(migration).toContain("table.primary(['tenant', 'link_id'])");
  });

  it('T111: enforces the entity-type and relationship check constraints', () => {
    const migration = readMigration();

    expect(migration).toContain("CHECK (entity_type IN ('ticket', 'comment'))");
    expect(migration).toContain("CHECK (relationship IN ('origin', 'mirror', 'reference'))");
    expect(migration).toContain("CHECK (key ~ '^custom:[a-z0-9_]+$')");
  });

  it('T112: unique external record and single-origin uniqueness constraints', () => {
    const migration = readMigration();

    expect(migration).toContain('external_entity_links_external_unique');
    expect(migration).toContain("COALESCE(external_parent_id, '')");
    expect(migration).toContain('external_entity_links_origin_unique');
    expect(migration).toContain("WHERE relationship = 'origin'");
  });

  it('T113: index and foreign keys match the plan, including ticket cascade', () => {
    const migration = readMigration();

    expect(migration).toContain('external_entity_links_ticket_idx');
    expect(migration).toContain('external_entity_links_external_lookup_idx');
    expect(migration).toContain('external_entity_links_ticket_fkey');
    expect(migration).toContain('REFERENCES tickets(tenant, ticket_id)');
    expect(migration).toContain('ON DELETE CASCADE');
  });

  it('T114: distributes both tables by tenant via the shared helper without a wrapping transaction', () => {
    const migration = readMigration();

    expect(migration).toContain("ensureTenantDistribution(knex, 'tenant_external_systems')");
    expect(migration).toContain("ensureTenantDistribution(knex, 'external_entity_links')");
    expect(migration).toContain("require('./utils/citusDistribution.cjs')");
    expect(migration).toContain('exports.config = { transaction: false };');
  });

  it('T115: created_by references users with the tenant in the key', () => {
    const migration = readMigration();

    expect(migration).toContain('external_entity_links_created_by_fkey');
    expect(migration).toContain('REFERENCES users(tenant, user_id)');
  });
});
