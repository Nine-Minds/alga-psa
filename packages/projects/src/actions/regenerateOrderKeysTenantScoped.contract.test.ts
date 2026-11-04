import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const source = readFileSync(resolve(__dirname, '../services/projectOrderingService.ts'), 'utf8');
const actionSource = readFileSync(resolve(__dirname, 'regenerateOrderKeys.ts'), 'utf8');
const taskActionSource = readFileSync(resolve(__dirname, 'projectTaskActions.ts'), 'utf8');
const projectActionSource = readFileSync(resolve(__dirname, 'projectActions.ts'), 'utf8');

describe('regenerate order keys tenant-scoped query contract', () => {
  it('uses structural tenant scoping for task and phase ordering roots', () => {
    expect(source).toContain("db.table('project_phases').where('project_id', scope.projectId)");
    expect(source).toContain("db.table('project_tasks').where({ phase_id: scope.phaseId, project_status_mapping_id: scope.statusId })");
    expect(source).toContain('tenantDb(trx, tenant).table(table).where(primaryKey, rows[index].id)');
    expect(source).not.toContain(".where('tenant', tenant)");
  });

  it('regenerates inside the caller transaction as plain helpers, not server actions', () => {
    expect(source).not.toMatch(/^['"]use server['"]/m);
    expect(source).toContain('withTransaction(conn, async trx =>');
    expect(source).not.toContain('createTenantKnex');
    expect(source).not.toContain('db.transaction(');
  });

  it('keeps the exported actions as thin adapters that never call one another', () => {
    for (const name of [
      'regenerateOrderKeysForStatus',
      'validateAndFixOrderKeys',
      'regenerateOrderKeysForPhases',
      'validateAndFixPhaseOrderKeys',
    ]) {
      expect(actionSource).toContain(`export const ${name} = withAuth(`);
      expect(actionSource).not.toMatch(new RegExp(`await ${name}\\(`));
    }
  });

  it('reorderPhase / reorderTask repair through the ordering service on their own transaction', () => {
    expect(projectActionSource).toContain('await regeneratePhaseOrderKeys(trx, tenant, phase.project_id);');
    expect(taskActionSource).toContain('await repairTaskOrderKeys(trx, tenant, task.phase_id, task.project_status_mapping_id);');
    for (const text of [projectActionSource, taskActionSource]) {
      expect(text).not.toContain("import('./regenerateOrderKeys')");
      expect(text).not.toContain("from './regenerateOrderKeys'");
    }
  });
});
