import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const source = readFileSync(resolve(__dirname, 'regenerateOrderKeys.ts'), 'utf8');

describe('regenerate order keys tenant-scoped query contract', () => {
  it('uses structural tenant scoping for task and phase ordering roots', () => {
    expect(source).toContain("tenantScopedTable(trx, 'project_tasks', tenant)");
    expect(source).toContain("tenantScopedTable(db, 'project_tasks', tenant)");
    expect(source).toContain("tenantScopedTable(trx, 'project_phases', tenant)");
    expect(source).toContain("tenantScopedTable(db, 'project_phases', tenant)");
    expect(source).not.toContain(".where('tenant', tenant)");
  });
});
