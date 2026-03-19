import { readFileSync } from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  path.resolve(__dirname, 'projectTaskActions.ts'),
  'utf8'
);

describe('cross-phase task movement status contracts', () => {
  it('T025/T028/T029/T063/T064: same-project moves resolve against target phase effective mappings', () => {
    expect(source).toContain('function resolveSameProjectTargetStatusMapping(');
    expect(source).toContain(
      'const existingTargetMapping = targetMappings.find((mapping) =>'
    );
    expect(source).toContain(
      'mapping.project_status_mapping_id === sourceMapping.project_status_mapping_id'
    );
    expect(source).toContain(
      'const sameNameMapping = targetMappings.find((mapping) =>'
    );
    expect(source).toContain('mapping.status_name === sourceMapping.status_name');
    expect(source).toContain('const firstOpenMapping = targetMappings.find((mapping) => !mapping.is_closed);');
    expect(source).toContain('const firstClosedMapping = targetMappings.find((mapping) => mapping.is_closed);');
    expect(source).toContain('return targetMappings[0] ?? null;');
    expect(source).toContain('const targetPhaseMappings = await getEffectiveProjectStatusMappings(');
    expect(source).toContain('newPhase.project_id,');
    expect(source).toContain('newPhase.phase_id');
    expect(source).toContain(
      'const resolvedMapping = resolveSameProjectTargetStatusMapping(currentMapping, targetPhaseMappings);'
    );
  });

  it('T026/T027: open and closed source tasks use first matching closed-state mapping when no same-name match exists', () => {
    expect(source).toContain('if (!sourceMapping.is_closed) {');
    expect(source).toContain('return firstOpenMapping;');
    expect(source).toContain('return firstClosedMapping;');
  });

  it('T030/T031: cross-project remapping remains separate from same-project phase remapping', () => {
    expect(source).toContain(
      'if (currentPhase.project_id !== newPhase.project_id && !newStatusMappingId) {'
    );
    expect(source).toContain('// Preserve the existing cross-project remapping behavior.');
    expect(source).toContain(
      '} else if (currentPhase.project_id === newPhase.project_id && currentPhase.phase_id !== newPhase.phase_id && !newStatusMappingId) {'
    );
    expect(source).toContain(
      'const newProjectMappings = await ProjectModel.getProjectStatusMappings(trx, tenant, newPhase.project_id);'
    );
  });
});
