// @vitest-environment node

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(__dirname, '../../../../..');

function read(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

/**
 * Mobile reads a task through GET /api/v1/projects/tasks/{id} and prefills its
 * time entry from the response, so that endpoint has to resolve the same
 * task → phase → project service fallback the web work-item queries resolve.
 * Hand-rolled COALESCE here would drift from `@alga-psa/core`'s fragments.
 */
describe('project task API effective-service contract', () => {
  const source = read('server/src/lib/api/services/ProjectService.ts');

  it('resolves the task service fallback with the shared core fragments', () => {
    expect(source).toContain("from '@alga-psa/core'");
    expect(source).toContain('effectiveServiceIdSql(TASK_SERVICE_ALIASES)');
    expect(source).toContain('effectiveServiceSourceSql(TASK_SERVICE_ALIASES)');
    expect(source).toContain('effectiveServiceNameSql(TASK_SERVICE_CATALOG_ALIASES)');
    expect(source).not.toMatch(/COALESCE\(project_tasks\.service_id/);
  });

  it('exposes the resolved id, its source and its name on the task detail row', () => {
    expect(source).toContain('as effective_service_id');
    expect(source).toContain('as service_source');
    expect(source).toContain('as service_name');
  });

  it('joins service_catalog once per hierarchy level so the name matches the id', () => {
    for (const [alias, column] of [
      ['task_service', 'project_tasks.service_id'],
      ['phase_service', 'project_phases.service_id'],
      ['project_service', 'projects.service_id'],
    ]) {
      expect(source).toContain(`'service_catalog as ${alias}', '${column}', '${alias}.service_id'`);
    }
  });

  it('keeps the web work-item queries on the same fragments', () => {
    for (const relativePath of [
      'packages/scheduling/src/actions/workItemActions.ts',
      'packages/scheduling/src/actions/timeEntryWorkItemActions.ts',
    ]) {
      const schedulingSource = read(relativePath);
      expect(schedulingSource).toContain('effectiveServiceIdSql(');
      expect(schedulingSource).toContain('effectiveServiceSourceSql(');
      expect(schedulingSource).toContain('effectiveServiceNameSql(');
    }
  });
});
