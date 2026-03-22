import { readFileSync } from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

const readWorkspaceFile = (relativePath: string) =>
  readFileSync(path.resolve(__dirname, '../../..', relativePath), 'utf8');

describe('per-phase status backward compatibility contracts', () => {
  const modelSource = readWorkspaceFile('packages/projects/src/models/project.ts');
  const settingsSource = readWorkspaceFile('packages/projects/src/components/settings/projects/ProjectTaskStatusSettings.tsx');
  const migrationSource = readWorkspaceFile('server/migrations/20260318100000_add_phase_id_to_project_status_mappings.cjs');
  const templateMigrationSource = readWorkspaceFile('server/migrations/20260318101000_add_template_phase_id_to_project_template_status_mappings.cjs');
  const citusMigrationSource = readWorkspaceFile('ee/server/migrations/citus/20260318102000_fix_phase_status_mapping_foreign_keys.cjs');

  it('T057/T059: phases without custom statuses fall back to project defaults and settings still start at project scope', () => {
    expect(modelSource).toContain('if (!phaseId) {');
    expect(modelSource).toContain('return ProjectModel.getProjectStatusMappings(knexOrTrx, tenant, projectId);');
    expect(modelSource).toContain('const phaseMappings = await ProjectModel.getProjectStatusMappings(knexOrTrx, tenant, projectId, phaseId);');
    expect(modelSource).toContain('if (phaseMappings.length > 0) {');
    expect(settingsSource).toContain("const DEFAULT_SCOPE = '__project_defaults__';");
    expect(settingsSource).toContain("const [selectedScope, setSelectedScope] = useState<string>(DEFAULT_SCOPE);");
    expect(settingsSource).toContain('const defaults = await getProjectStatusMappings(projectId);');
  });

  it('T058: migrations stay additive so existing task status mapping ids remain untouched', () => {
    expect(migrationSource).toContain("table.uuid('phase_id').nullable();");
    expect(templateMigrationSource).toContain("table.uuid('template_phase_id').nullable();");
    expect(migrationSource).not.toContain('UPDATE project_status_mappings');
    expect(templateMigrationSource).not.toContain('UPDATE project_template_status_mappings');
    expect(migrationSource).not.toContain('DELETE FROM project_status_mappings');
  });

  it('T061: phase deletion cleanup relies on cascade foreign keys for phase-scoped mappings', () => {
    expect(migrationSource).toContain(".foreign(['tenant', 'phase_id'])");
    expect(migrationSource).toContain(".references(['tenant', 'phase_id'])");
    expect(migrationSource).toContain(".onDelete('CASCADE')");
    expect(templateMigrationSource).toContain(".foreign(['tenant', 'template_phase_id'])");
    expect(templateMigrationSource).toContain(".references(['tenant', 'template_phase_id'])");
    expect(citusMigrationSource).toContain("requiredColumns: ['tenant', 'phase_id']");
    expect(citusMigrationSource).toContain("requiredForeignColumns: ['tenant', 'phase_id']");
    expect(citusMigrationSource).toContain("onDelete: 'CASCADE'");
  });
});
