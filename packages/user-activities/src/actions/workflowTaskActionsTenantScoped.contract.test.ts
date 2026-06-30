import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const sourcePath = resolve(__dirname, 'workflowTaskActions.ts');
const source = readFileSync(sourcePath, 'utf8');

describe('workflow task actions tenant-scoped query contract', () => {
  it('uses structural tenant scoping for workflow task read and update roots', () => {
    expect(source).toContain('tenantDb(trx, ');
    expect(source).toContain('.table("workflow_tasks');

    expect(source).not.toMatch(/trx\("workflow_tasks"\)\s*[\r\n]+\s*\.where/);
    expect(source).not.toContain('.where("tenant", tenant)');
  });
});
