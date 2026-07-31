import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const source = readFileSync(resolve(__dirname, 'projectTaskActions.ts'), 'utf8');
const section = source.slice(
  source.indexOf('export const moveTaskToPhase'),
  source.indexOf('export const duplicateTaskToPhase')
);

describe('project task move tenant-scoped query contract', () => {
  it('uses structural tenant scoping for phase move task and ticket-link roots', () => {
    expect(section).toContain("tenantScopedTable(trx, 'project_tasks', tenant)");
    expect(section).toContain("tenantScopedTable(trx, 'project_ticket_links', tenant)");
    expect(section).not.toContain(".where({ task_id: beforeTaskId, tenant })");
    expect(section).not.toContain(".where({ task_id: afterTaskId, tenant })");
    expect(section).not.toContain('project_status_mapping_id: finalStatusMappingId,\n                        tenant');
    expect(section).not.toContain(".andWhere('tenant', tenant)");
  });
});
