import { readFileSync } from 'fs';
import path from 'path';

const serverRoot = path.resolve(__dirname, '../../../../');
const repoRoot = path.resolve(serverRoot, '..');

const readServerFile = (relativePath: string) =>
  readFileSync(path.resolve(serverRoot, relativePath), 'utf8');

const readWorkspaceFile = (relativePath: string) =>
  readFileSync(path.resolve(repoRoot, relativePath), 'utf8');

describe('per-phase task statuses migrations', () => {
  const projectStatusesMigration = readServerFile(
    'migrations/20260318100000_add_phase_id_to_project_status_mappings.cjs'
  );
  const templateStatusesMigration = readServerFile(
    'migrations/20260318101000_add_template_phase_id_to_project_template_status_mappings.cjs'
  );
  const citusCompanionMigration = readWorkspaceFile(
    'ee/server/migrations/citus/20260318102000_fix_phase_status_mapping_foreign_keys.cjs'
  );

  it('T001/T002/T005: adds nullable phase_id and template_phase_id columns with cascade FKs', () => {
    expect(projectStatusesMigration).toContain("table.uuid('phase_id').nullable()");
    expect(projectStatusesMigration).toContain(".foreign(['tenant', 'phase_id'])");
    expect(projectStatusesMigration).toContain(".references(['tenant', 'phase_id'])");
    expect(projectStatusesMigration).toContain(".inTable('project_phases')");
    expect(projectStatusesMigration).toContain(".onDelete('CASCADE')");
    expect(templateStatusesMigration).toContain("table.uuid('template_phase_id').nullable()");
    expect(templateStatusesMigration).toContain(".foreign(['tenant', 'template_phase_id'])");
    expect(templateStatusesMigration).toContain(".references(['tenant', 'template_phase_id'])");
    expect(templateStatusesMigration).toContain(".inTable('project_template_phases')");
    expect(templateStatusesMigration).toContain(".onDelete('CASCADE')");
  });

  it('T003/T004: adds the tenant-project-phase index and keeps migration additive', () => {
    expect(projectStatusesMigration).toContain("table.index(['tenant', 'project_id', 'phase_id'])");
    expect(projectStatusesMigration).not.toContain('UPDATE project_status_mappings');
    expect(projectStatusesMigration).not.toContain(".notNullable()");
    expect(templateStatusesMigration).not.toContain('UPDATE project_template_status_mappings');
    expect(templateStatusesMigration).not.toContain(".notNullable()");
  });

  it('T006: keeps EE companion migration transactionless and enforces composite phase foreign keys', () => {
    expect(citusCompanionMigration).toContain('exports.config = { transaction: false }');
    expect(citusCompanionMigration).toContain("requiredColumns: ['tenant', 'phase_id']");
    expect(citusCompanionMigration).toContain("requiredForeignColumns: ['tenant', 'phase_id']");
    expect(citusCompanionMigration).toContain('project_status_mappings_tenant_phase_id_foreign');
    expect(citusCompanionMigration).toContain("requiredColumns: ['tenant', 'template_phase_id']");
    expect(citusCompanionMigration).toContain(
      "requiredForeignColumns: ['tenant', 'template_phase_id']"
    );
    expect(citusCompanionMigration).toContain(
      'project_template_status_mappings_tenant_template_phase_id_foreign'
    );
    expect(citusCompanionMigration).toContain('FOREIGN KEY (${requiredColumns.join');
    expect(citusCompanionMigration).toContain('REFERENCES ${foreignTableName}(${requiredForeignColumns.join');
    expect(citusCompanionMigration).toContain("onDelete: 'CASCADE'");
  });
});
