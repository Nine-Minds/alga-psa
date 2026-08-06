import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  resolve(__dirname, '../../../lib/api/services/ProjectService.ts'),
  'utf8'
);

describe('API ProjectService.createTask status-scope contract', () => {
  it('rejects a cross-phase or cross-project task status mapping on create', () => {
    expect(source).toContain('async createTask(phaseId: string, data: CreateProjectTaskData');
    expect(source).toContain(
      'if (!data.project_status_mapping_id) {'
    );
    expect(source).toContain(
      'const statusMapping = await ProjectModel.getProjectStatusMapping(trx, context.tenant, data.project_status_mapping_id);'
    );
    expect(source).toContain('statusMapping.project_id !== phase.project_id');
    expect(source).toContain('throw new ValidationError');
    expect(source).toContain(
      'await ProjectModel.isTaskStatusMappingInScope('
    );
    expect(source).toContain(
      "throw new ValidationError('Task status is not in the selected phase\\'s status scope');"
    );
  });
});