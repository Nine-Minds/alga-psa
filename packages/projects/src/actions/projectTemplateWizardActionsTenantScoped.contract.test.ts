import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const source = readFileSync(resolve(__dirname, 'projectTemplateWizardActions.ts'), 'utf8');

describe('project template wizard tenant-scoped query contract', () => {
  it('uses structural tenant scoping for editor update and save-as-copy roots', () => {
    expect(source).toContain("import { createTenantKnex, createTenantScopedQuery, withTransaction } from '@alga-psa/db'");
    expect(source).toContain("tenantScopedTable(trx, 'project_templates', tenant)");
    expect(source).toContain("tenantScopedTable(trx, 'project_template_status_mappings', tenant)");
    expect(source).toContain("tenantScopedTable(trx, 'project_template_phases', tenant)");
    expect(source).toContain("tenantScopedTable(trx, 'project_template_tasks', tenant)");
    expect(source).toContain("tenantScopedTable(trx, 'project_template_dependencies', tenant)");
    expect(source).toContain("tenantScopedTable(trx, 'project_template_checklist_items', tenant)");
    expect(source).not.toContain('.where({ template_id: templateId, tenant })');
    expect(source).not.toContain('.where({ template_id: sourceTemplateId, tenant })');
    expect(source).not.toContain(".where('tenant', tenant)");
  });
});
