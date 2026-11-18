import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';

const taskTypeSource = readFileSync(resolve(__dirname, '../models/taskType.ts'), 'utf8');
const orderingSource = readFileSync(resolve(__dirname, '../services/projectOrderingService.ts'), 'utf8');
const statusMappingSource = readFileSync(resolve(__dirname, 'projectStatusMappingUtils.ts'), 'utf8');

describe('project utility tenant-scoped query contract', () => {
  it('uses structural tenant scoping for custom task type roots', () => {
    expect(taskTypeSource).toContain("tenantScopedTable(knexOrTrx, 'custom_task_types', tenant)");
    expect(taskTypeSource).toContain("tenantScopedTable<ITaskType>(knexOrTrx, 'standard_task_types', tenant)");
    expect(taskTypeSource).not.toContain("knexOrTrx('standard_task_types')");
    expect(taskTypeSource).not.toContain('.where({ tenant, is_active: true })');
    expect(taskTypeSource).not.toContain('.where({ tenant, type_key: typeKey, is_active: true })');
    expect(taskTypeSource).not.toContain('.where({ type_id: typeId, tenant })');
  });

  it('uses structural tenant scoping for ordering update roots', () => {
    expect(orderingSource).toContain("db.table('project_tasks')");
    expect(orderingSource).toContain("db.table('project_phases')");
    expect(orderingSource).not.toContain('.where({ task_id: taskId, tenant })');
    expect(orderingSource).not.toContain('.where({ phase_id: phaseId, tenant })');
  });

  it('keeps no use-server ordering endpoint (S4)', () => {
    expect(existsSync(resolve(__dirname, 'orderingService.ts'))).toBe(false);
    expect(orderingSource).not.toMatch(/^['"]use server['"]/m);
    const serverOrdering = readFileSync(resolve(__dirname, '../../../../server/src/lib/services/orderingService.ts'), 'utf8');
    expect(serverOrdering).not.toContain('reorderProjectTask');
    expect(serverOrdering).not.toContain('reorderProjectPhase');
  });

  it('uses structural tenant scoping for project status mapping roots', () => {
    expect(statusMappingSource).toContain(".table('project_status_mappings as psm')");
    expect(statusMappingSource).toContain("db.tenantJoin(query, 'statuses as s', 'psm.status_id', 's.status_id', { type: 'left' })");
    expect(statusMappingSource).not.toContain("'psm.tenant': tenant");
  });
});
