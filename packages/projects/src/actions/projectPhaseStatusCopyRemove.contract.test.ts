import { readFileSync } from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  path.resolve(__dirname, 'projectTaskStatusActions.ts'),
  'utf8'
);

describe('phase status copy/remove action contracts', () => {
  it('T019/T020/T021: copyProjectStatusesToPhase delegates to the shared clone+remap that preserves standard mappings', () => {
    expect(source).toContain('export const copyProjectStatusesToPhase = withAuth(async (');
    expect(source).toContain(
      'return await ProjectModel.copyProjectStatusMappingsToPhase(trx, tenant, projectId, phaseId);'
    );
    // The shared helper clones defaults, remaps tasks by stable semantic
    // identity (never nullable status_id), and is idempotent for existing scopes.
    const modelSource = readFileSync(
      path.resolve(__dirname, '../models/project.ts'),
      'utf8'
    );
    expect(modelSource).toContain('copyProjectStatusMappingsToPhase: async (');
    expect(modelSource).toContain("const defaultMappings = await ProjectModel.getProjectStatusMappings(knexOrTrx, tenant, projectId);");
    expect(modelSource).toContain('buildStatusMappingCloneCorrespondence(defaultMappings, newMappings);');
    expect(modelSource).toContain("tenantScopedTable(knexOrTrx, 'project_tasks', tenant)");
    expect(modelSource).toContain("project_status_mapping_id: oldId");
  });

  it('T022/T023/T024: removePhaseStatuses remaps phase tasks to project defaults before deleting phase mappings', () => {
    expect(source).toContain('export const removePhaseStatuses = withAuth(async (');
    expect(source).toContain(
      'const phaseMappings = await getScopedProjectStatusMappings(trx, tenant, phase.project_id, phaseId);'
    );
    expect(source).toContain(
      'const defaultMappings = await getScopedProjectStatusMappings(trx, tenant, phase.project_id);'
    );
    expect(source).toContain(
      'const replacementMapping = resolveReplacementStatusMapping(phaseMapping, defaultMappings);'
    );
    expect(source).toContain("await tenantScopedTable(trx, 'project_tasks', tenant)");
    expect(source).toContain('replacementMapping.project_status_mapping_id');
    expect(source).toContain('phaseMapping.project_status_mapping_id');
    expect(source).toContain(".where({ phase_id: phaseId })");
    expect(source).toContain('.del();');
  });
});
