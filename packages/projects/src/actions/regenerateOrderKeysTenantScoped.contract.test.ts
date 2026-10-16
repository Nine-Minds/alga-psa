import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const source = readFileSync(resolve(__dirname, '../services/projectOrderingService.ts'), 'utf8');

describe('regenerate order keys tenant-scoped query contract', () => {
  it('uses structural tenant scoping for task and phase ordering roots', () => {
    expect(source).toContain("db.table('project_phases').where('project_id', scope.projectId)");
    expect(source).toContain("db.table('project_tasks').where({ phase_id: scope.phaseId, project_status_mapping_id: scope.statusId })");
    expect(source).toContain('tenantDb(trx, tenant).table(table).where(primaryKey, rows[index].id)');
    expect(source).not.toContain(".where('tenant', tenant)");
  });
});
