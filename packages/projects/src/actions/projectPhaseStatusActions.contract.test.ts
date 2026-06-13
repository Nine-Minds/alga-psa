import { readFileSync } from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

const actionsRoot = __dirname;

const readActionSource = (fileName: string) =>
  readFileSync(path.resolve(actionsRoot, fileName), 'utf8');

describe('phase-aware project status action contracts', () => {
  const projectTaskStatusActionsSource = readActionSource('projectTaskStatusActions.ts');
  const projectActionsSource = readActionSource('projectActions.ts');

  it('T015: addStatusToProject stores project defaults or phase-specific mappings based on phaseId', () => {
    expect(projectTaskStatusActionsSource).toContain(
      'export const addStatusToProject = withAuth(async ('
    );
    expect(projectTaskStatusActionsSource).toContain('phaseId?: string | null');
    expect(projectTaskStatusActionsSource).toContain("maxOrderQuery.andWhere('phase_id', phaseId);");
    expect(projectTaskStatusActionsSource).toContain("maxOrderQuery.whereNull('phase_id');");
    expect(projectTaskStatusActionsSource).toContain('phase_id: phaseId ?? null,');
  });

  it('T016/T017: getProjectStatusMappings and reorderProjectStatuses scope queries to a phase or project defaults', () => {
    // The scoped-mapping helper now lives in lib/projectStatusMappingUtils and
    // is imported by the actions module.
    const statusMappingUtilsSource = readFileSync(
      path.resolve(actionsRoot, '../lib/projectStatusMappingUtils.ts'),
      'utf8'
    );
    expect(statusMappingUtilsSource).toContain(
      'export async function getScopedProjectStatusMappings('
    );
    expect(statusMappingUtilsSource).toContain("query.andWhere('psm.phase_id', phaseId);");
    expect(statusMappingUtilsSource).toContain("query.whereNull('psm.phase_id');");
    expect(projectTaskStatusActionsSource).toContain(
      "import { getScopedProjectStatusMappings, ProjectStatusMappingDetails } from '../lib/projectStatusMappingUtils';"
    );
    expect(projectTaskStatusActionsSource).toContain(
      'export const getProjectStatusMappings = withAuth(async ('
    );
    expect(projectTaskStatusActionsSource).toContain(
      'return await getScopedProjectStatusMappings(trx, tenant, projectId, phaseId);'
    );
    expect(projectTaskStatusActionsSource).toContain(
      'export const reorderProjectStatuses = withAuth(async ('
    );
    expect(projectTaskStatusActionsSource).toContain("query.andWhere('phase_id', phaseId);");
    expect(projectTaskStatusActionsSource).toContain("query.whereNull('phase_id');");
  });

  it('T018: getProjectTaskStatuses threads phaseId into effective resolution', () => {
    expect(projectActionsSource).toContain('export const getProjectTaskStatuses = withAuth(async (');
    expect(projectActionsSource).toContain('phaseId?: string | null');
    expect(projectActionsSource).toContain(
      'return await getProjectTaskStatusesInternal(trx, tenant, projectId, user, phaseId);'
    );
    expect(projectActionsSource).toContain(
      'const statusMappings = await ProjectModel.getEffectiveStatusMappings(trx, tenant, projectId, phaseId);'
    );
  });
});
