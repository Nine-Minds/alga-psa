import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const migrationPath = path.resolve(
  testDir,
  '../../../migrations/20260513120000_create_app_search_index.cjs',
);

function readSearchIndexMigration(): string {
  return readFileSync(migrationPath, 'utf8');
}

function appSearchIndexCreateTableBody(): string {
  const migration = readSearchIndexMigration();
  const tableMatch = migration.match(/CREATE TABLE app_search_index \(([\s\S]*?)\n\s*\)\s*`/);
  if (!tableMatch) {
    throw new Error('Could not find app_search_index CREATE TABLE statement');
  }

  return tableMatch[1];
}

function appSearchIndexColumnDefinitions(): Record<string, string> {
  const tableBody = appSearchIndexCreateTableBody();

  return Object.fromEntries(
    tableBody
      .split('\n')
      .map((line) => line.trim().replace(/,$/, '').replace(/\s+/g, ' '))
      .filter((line) => line.length > 0 && !line.startsWith('PRIMARY KEY'))
      .map((line) => {
        const [columnName] = line.split(' ');
        return [columnName, line];
      }),
  );
}

describe('app_search_index migration contract', () => {
  it('T001 creates app_search_index with the PRD column names and SQL types', () => {
    const columns = appSearchIndexColumnDefinitions();
    const expectedColumns: Record<string, string> = {
      tenant: 'tenant uuid NOT NULL',
      object_type: 'object_type text NOT NULL',
      object_id: 'object_id text NOT NULL',
      parent_type: 'parent_type text',
      parent_id: 'parent_id text',
      title: 'title text NOT NULL',
      subtitle: 'subtitle text',
      body: 'body text',
      url: 'url text NOT NULL',
      metadata: "metadata jsonb NOT NULL DEFAULT '{}'::jsonb",
      visible_to_user_ids: "visible_to_user_ids uuid[] NOT NULL DEFAULT '{}'::uuid[]",
      visible_to_roles: "visible_to_roles text[] NOT NULL DEFAULT '{}'::text[]",
      is_internal_only: 'is_internal_only boolean NOT NULL DEFAULT false',
      is_private: 'is_private boolean NOT NULL DEFAULT false',
      client_scope_id: 'client_scope_id uuid',
      required_permission: 'required_permission text',
      search_vector: 'search_vector tsvector NOT NULL',
      search_lang: "search_lang text NOT NULL DEFAULT 'english'",
      source_updated_at: 'source_updated_at timestamptz NOT NULL',
      indexed_at: 'indexed_at timestamptz NOT NULL DEFAULT now()',
    };

    expect(Object.keys(columns)).toEqual(Object.keys(expectedColumns));
    expect(columns).toEqual(expectedColumns);
  });

  it('T002 keeps tenant non-null and uses the tenant/type/id composite primary key', () => {
    const tableBody = appSearchIndexCreateTableBody().replace(/\s+/g, ' ');
    const columns = appSearchIndexColumnDefinitions();

    expect(columns.tenant).toBe('tenant uuid NOT NULL');
    expect(tableBody).toContain('PRIMARY KEY (tenant, object_type, object_id)');
  });

  it('T003 enables pg_trgm with the idempotent extension form', () => {
    const migration = readSearchIndexMigration();

    expect(migration).toContain("CREATE EXTENSION IF NOT EXISTS pg_trgm");
    expect(migration).not.toContain("CREATE EXTENSION pg_trgm");
  });
});
