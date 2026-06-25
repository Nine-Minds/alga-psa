import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const taskTypeSource = readFileSync(resolve(__dirname, '../models/taskType.ts'), 'utf8');
const orderingSource = readFileSync(resolve(__dirname, 'orderingService.ts'), 'utf8');
const statusMappingSource = readFileSync(resolve(__dirname, 'projectStatusMappingUtils.ts'), 'utf8');

describe('project utility tenant-scoped query contract', () => {
  it('uses structural tenant scoping for custom task type roots', () => {
    expect(taskTypeSource).toContain("tenantScopedTable(knexOrTrx, 'custom_task_types', tenant)");
    expect(taskTypeSource).toContain("knexOrTrx('standard_task_types')");
    expect(taskTypeSource).not.toContain('.where({ tenant, is_active: true })');
    expect(taskTypeSource).not.toContain('.where({ tenant, type_key: typeKey, is_active: true })');
    expect(taskTypeSource).not.toContain('.where({ type_id: typeId, tenant })');
  });

  it('uses structural tenant scoping for ordering update roots', () => {
    expect(orderingSource).toContain("tenantScopedTable(db, 'project_tasks', tenant)");
    expect(orderingSource).toContain("tenantScopedTable(db, 'project_phases', tenant)");
    expect(orderingSource).not.toContain('.where({ task_id: taskId, tenant })');
    expect(orderingSource).not.toContain('.where({ phase_id: phaseId, tenant })');
  });

  it('uses structural tenant scoping for project status mapping roots', () => {
    expect(statusMappingSource).toContain("table: 'project_status_mappings as psm'");
    expect(statusMappingSource).toContain(".andOn('psm.tenant', '=', 's.tenant')");
    expect(statusMappingSource).not.toContain("'psm.tenant': tenant");
  });
});
