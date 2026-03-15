import { describe, expect, it } from 'vitest';
import path from 'path';
import { readFileSync } from 'node:fs';

function readRepoFile(relativePathFromRepoRoot: string): string {
  const repoRoot = path.resolve(__dirname, '../../../../..');
  return readFileSync(path.join(repoRoot, relativePathFromRepoRoot), 'utf8');
}

describe('board-specific ticket statuses migration', () => {
  const migration = readRepoFile(
    'server/migrations/20260314100000_add_board_ownership_to_ticket_statuses.cjs'
  );
  const slaPauseConfigMigration = readRepoFile(
    'server/migrations/20260314134000_remap_sla_pause_ticket_status_configs.cjs'
  );

  it('T001: adds nullable board ownership support for statuses without forcing non-ticket rows onto boards', () => {
    expect(migration).toContain("table.uuid('board_id').nullable()");
    expect(migration).toContain("table.index(['tenant', 'board_id'], 'statuses_tenant_board_id_idx')");
    expect(migration).toContain(".foreign(['tenant', 'board_id'], 'statuses_tenant_board_id_fk')");
    expect(migration).toContain(".references(['tenant', 'board_id'])");
    expect(migration).toContain(".inTable('boards')");
    expect(migration).not.toContain("table.uuid('board_id').notNullable()");
  });

  it('T002: replaces tenant-global uniqueness with board-scoped ticket indexes and preserves non-ticket uniqueness', () => {
    expect(migration).toContain('DROP CONSTRAINT IF EXISTS unique_tenant_name_type');
    expect(migration).toContain('DROP CONSTRAINT IF EXISTS unique_tenant_type_order');
    expect(migration).toContain('CREATE UNIQUE INDEX statuses_ticket_board_name_unique_idx');
    expect(migration).toContain("WHERE status_type = 'ticket'");
    expect(migration).toContain('CREATE UNIQUE INDEX statuses_ticket_board_order_unique_idx');
    expect(migration).toContain('CREATE UNIQUE INDEX statuses_ticket_board_default_unique_idx');
    expect(migration).toContain("WHERE status_type = 'ticket' AND is_default = true");
    expect(migration).toContain('CREATE UNIQUE INDEX statuses_non_ticket_name_unique_idx');
    expect(migration).toContain("WHERE status_type <> 'ticket'");
    expect(migration).toContain('CREATE UNIQUE INDEX statuses_non_ticket_order_unique_idx');
    expect(migration).toContain('CREATE INDEX statuses_ticket_board_lookup_idx');
  });

  it('clones legacy SLA pause config rows onto board-owned ticket statuses and removes legacy ticket-status configs', () => {
    expect(slaPauseConfigMigration).toContain("knex('status_sla_pause_config as cfg')");
    expect(slaPauseConfigMigration).toContain(".where('legacy.status_type', 'ticket')");
    expect(slaPauseConfigMigration).toContain(".whereNull('legacy.board_id')");
    expect(slaPauseConfigMigration).toContain(".whereNotNull('board_id')");
    expect(slaPauseConfigMigration).toContain(".onConflict(['tenant', 'status_id'])");
    expect(slaPauseConfigMigration).toContain('deleteLegacyTicketStatusConfigs');
    expect(slaPauseConfigMigration).toContain('deleteBoardOwnedTicketStatusConfigs');
  });
});
