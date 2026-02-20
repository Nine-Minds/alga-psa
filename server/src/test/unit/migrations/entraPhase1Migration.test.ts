import { describe, expect, it } from 'vitest';
import path from 'path';
import { readFileSync } from 'node:fs';

function readRepoFile(relativePathFromRepoRoot: string): string {
  const repoRoot = path.resolve(__dirname, '../../../../..');
  return readFileSync(path.join(repoRoot, relativePathFromRepoRoot), 'utf8');
}

describe('Entra Phase 1 migration', () => {
  const migration = readRepoFile('ee/server/migrations/20260220143000_create_entra_phase1_schema.cjs');

  it('T011: creates entra_partner_connections with expected required columns', () => {
    expect(migration).toContain("createTable('entra_partner_connections'");
    expect(migration).toContain("table.uuid('tenant').notNullable()");
    expect(migration).toContain("table.text('connection_type').notNullable()");
    expect(migration).toContain("table.text('status').notNullable().defaultTo('disconnected')");
    expect(migration).toContain("table.boolean('is_active').notNullable().defaultTo(false)");
    expect(migration).toContain("table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now())");
    expect(migration).toContain("table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now())");
  });
});
