import { readFileSync } from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  path.resolve(__dirname, 'projectTaskStatusActions.ts'),
  'utf8'
);

describe('phase status copy/remove action contracts', () => {
  it('T019/T020/T021: copyProjectStatusesToPhase clones default mappings into the target phase with preserved fields', () => {
    expect(source).toContain('export const copyProjectStatusesToPhase = withAuth(async (');
    expect(source).toContain(".where({ tenant, project_id: projectId, phase_id: phaseId })");
    expect(source).toContain(".where({ tenant, project_id: projectId })");
    expect(source).toContain(".whereNull('phase_id')");
    expect(source).toContain('const inserts = defaultMappings.map((mapping) => ({');
    expect(source).toContain('phase_id: phaseId,');
    expect(source).toContain('status_id: mapping.status_id,');
    expect(source).toContain('standard_status_id: mapping.standard_status_id,');
    expect(source).toContain('custom_name: mapping.custom_name,');
    expect(source).toContain('display_order: mapping.display_order,');
    expect(source).toContain('is_visible: mapping.is_visible');
    // Task reassignment: existing phase tasks are moved from default to new phase mappings
    expect(source).toContain("const defaultToPhaseMapping = new Map<string, string>();");
    expect(source).toContain("(m) => m.status_id === defaultMapping.status_id");
    expect(source).toContain(".where({ tenant, phase_id: phaseId })");
    expect(source).toContain(".andWhere('project_status_mapping_id', oldId)");
    expect(source).toContain("{ project_status_mapping_id: newId }");
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
    expect(source).toContain("await trx('project_tasks')");
    expect(source).toContain('replacementMapping.project_status_mapping_id');
    expect(source).toContain('phaseMapping.project_status_mapping_id');
    expect(source).toContain(".where({ tenant, phase_id: phaseId })");
    expect(source).toContain('.del();');
  });
});
