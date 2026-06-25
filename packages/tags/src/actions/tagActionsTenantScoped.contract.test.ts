import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const source = readFileSync(resolve(__dirname, 'tagActions.ts'), 'utf8');

describe('tag actions tenant-scoped query contract', () => {
  it('uses structural tenant scoping for project-task context roots', () => {
    expect(source).toContain("table: 'project_tasks as pt'");
    expect(source).toContain("alias: 'pt'");
    expect(source).toContain('projectTasksQuery(trx, tenant)');

    expect(source).not.toContain(".where({ 'pt.tenant': tenant");
    expect(source).not.toContain(".where('pt.tenant', tenant)");
  });

  it('uses structural tenant scoping for tag-mapping definition joins', () => {
    expect(source).toContain("table: 'tag_mappings as tm'");
    expect(source).toContain("alias: 'tm'");
    expect(source).toContain('tagMappingsWithDefinitionsQuery(trx, tenant)');

    expect(source).not.toContain(".where('tm.tenant', tenant)");
  });
});
