import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const taskTypeSource = readFileSync(resolve(__dirname, '../models/taskType.ts'), 'utf8');
const statusMappingSource = readFileSync(resolve(__dirname, 'projectStatusMappingUtils.ts'), 'utf8');

describe('project utility tenant-scoped query contract', () => {
  // Writes moved under withCoManagedOperationalTransaction in 096b160555, which renamed the
  // connection binding knexOrTrx -> trx, so both bindings must be asserted here.
  it('uses structural tenant scoping for custom task type roots', () => {
    expect(taskTypeSource).toContain("tenantScopedTable<ITaskType>(knexOrTrx, 'custom_task_types', tenant)");
    expect(taskTypeSource).toContain("tenantScopedTable<ICustomTaskType>(trx, 'custom_task_types', tenant)");
    expect(taskTypeSource).toContain("tenantScopedTable(trx, 'custom_task_types', tenant)");
    expect(taskTypeSource).toContain("tenantScopedTable<ITaskType>(knexOrTrx, 'standard_task_types', tenant)");
    expect(taskTypeSource).not.toContain("knexOrTrx('standard_task_types')");
    expect(taskTypeSource).not.toContain('.where({ tenant, is_active: true })');
    expect(taskTypeSource).not.toContain('.where({ tenant, type_key: typeKey, is_active: true })');
    expect(taskTypeSource).not.toContain('.where({ type_id: typeId, tenant })');
  });

  it('uses structural tenant scoping for project status mapping roots', () => {
    expect(statusMappingSource).toContain(".table('project_status_mappings as psm')");
    expect(statusMappingSource).toContain("db.tenantJoin(query, 'statuses as s', 'psm.status_id', 's.status_id', { type: 'left' })");
    expect(statusMappingSource).not.toContain("'psm.tenant': tenant");
  });
});
