import { describe, expect, it } from 'vitest';
import path from 'path';
import { readFileSync } from 'node:fs';

function readRepoFile(relativePathFromRepoRoot: string): string {
  const repoRoot = path.resolve(__dirname, '../../../../..');
  return readFileSync(path.join(repoRoot, relativePathFromRepoRoot), 'utf8');
}

describe('teams integrations migration', () => {
  const migration = readRepoFile('ee/server/migrations/20260307153000_create_teams_integrations.cjs');

  it('T083/T084: creates a tenant-scoped Teams integration record and drops it on rollback', () => {
    expect(migration).toContain("createTable('teams_integrations'");
    expect(migration).toContain("table.uuid('tenant').notNullable()");
    expect(migration).toContain("table.uuid('selected_profile_id')");
    expect(migration).toContain("table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now())");
    expect(migration).toContain("table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now())");
    expect(migration).toContain("await knex.schema.dropTableIfExists('teams_integrations');");
  });

  it('T085/T087/T089/T091/T093: persists selected profile, install status, capabilities, notifications, and allowed actions', () => {
    expect(migration).toContain("table.text('install_status').notNullable().defaultTo('not_configured')");
    expect(migration).toContain("table.jsonb('enabled_capabilities').notNullable()");
    expect(migration).toContain("table.jsonb('notification_categories').notNullable()");
    expect(migration).toContain("table.jsonb('allowed_actions').notNullable()");
    expect(migration).toContain('teams_integrations_selected_profile_idx');
  });

  it('T086/T088/T090/T092/T094: constrains install status and profile linkage to tenant-scoped Microsoft profiles', () => {
    expect(migration).toContain('teams_integrations_install_status_check');
    expect(migration).toContain("CHECK (install_status IN ('not_configured', 'install_pending', 'active', 'error'))");
    expect(migration).toContain(".foreign(['tenant', 'selected_profile_id'])");
    expect(migration).toContain(".references(['tenant', 'profile_id'])");
    expect(migration).toContain(".inTable('microsoft_profiles')");
  });
});
