// @vitest-environment node

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(__dirname, '../../../..');

function readRepoFile(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

const sources = {
  displaySettings: readRepoFile('packages/tickets/src/actions/ticketDisplaySettings.ts'),
  materialCatalog: readRepoFile('packages/tickets/src/actions/materialCatalogActions.ts'),
  inventoryMaterials: readRepoFile('packages/inventory/src/lib/materials.ts'),
  checklistItems: readRepoFile('packages/tickets/src/actions/checklists/ticketChecklistActions.ts'),
  checklistTemplates: readRepoFile('packages/tickets/src/actions/checklists/checklistTemplateActions.ts'),
  applyChecklistTemplate: readRepoFile('packages/tickets/src/actions/checklists/applyChecklistTemplate.ts'),
  closeRules: readRepoFile('packages/tickets/src/actions/close-rules/closeRuleActions.ts'),
  validateClosure: readRepoFile('packages/tickets/src/lib/validateTicketClosure.ts'),
  sharedCloseRules: readRepoFile('shared/lib/ticketCloseRules/index.ts'),
  sharedChecklistTemplates: readRepoFile('shared/lib/ticketChecklists/applyTemplates.ts'),
};

const metadataSource = readRepoFile('packages/db/src/lib/tenantTableMetadata.ts');

const coveredTenantTables = [
  'board_auto_close_rules',
  'board_close_rules',
  'boards',
  'checklist_template_apply_rules',
  'checklist_template_items',
  'checklist_templates',
  'comments',
  'service_catalog',
  'service_prices',
  'statuses',
  'tenant_settings',
  'ticket_auto_close_state',
  'ticket_checklist_items',
  'ticket_materials',
  'tickets',
  'time_entries',
  'users',
];

function directRootPattern(table: string): RegExp {
  return new RegExp(`\\b(?:db|trx|knex)\\s*(?:<[^>]+>)?\\(\\s*['"]${table}(?:\\s+as\\s+\\w+)?['"]`);
}

describe('ticket close/checklist/material facade contract', () => {
  it('registers every tenant table used by the migrated roots', () => {
    for (const table of coveredTenantTables) {
      expect(metadataSource).toContain(`${table}: { scope: 'tenant' }`);
    }
  });

  it('keeps migrated ticket helper roots behind tenantDb', () => {
    const facadeSources = Object.entries(sources)
      .filter(([name]) => name !== 'materialCatalog' && name !== 'inventoryMaterials')
      .map(([, source]) => source);

    for (const source of facadeSources) {
      expect(source).toContain('tenantDb');
      expect(source).not.toContain('createTenantScopedQuery');
      expect(source).not.toMatch(/\.where\(\{[^}\n]*(?:\btenant\b|['"][^'"]*\.tenant['"])/);
      expect(source).not.toMatch(/\.andWhere\([^)\n]*(?:\btenant\b|['"][^'"]*\.tenant['"])/);
      expect(source).not.toMatch(/\.andOn\([^)\n]*(?:\btenant\b|['"][^'"]*\.tenant['"])/);

      for (const table of coveredTenantTables) {
        expect(source).not.toMatch(directRootPattern(table));
      }
    }

    expect(sources.materialCatalog).toContain("from '@alga-psa/inventory/lib'");
    expect(sources.materialCatalog).toContain("listMaterials(db, tenant, 'ticket', ticketId)");
    expect(sources.materialCatalog).toContain("{ ...input, parent_type: 'ticket', parent_id: input.ticket_id }");
    expect(sources.materialCatalog).toContain("deleteMaterial(db, tenant, 'ticket', ticketMaterialId");
  });

  it('uses facade joins for the migrated tenant-table joins', () => {
    // The canonical inventory service deliberately stays importable without the
    // server-action stack, so pin its equivalent explicit tenant predicates.
    expect(sources.inventoryMaterials).toContain("this.on('m.service_id', '=', 'sc.service_id').andOn('m.tenant', '=', 'sc.tenant')");
    expect(sources.inventoryMaterials).toContain(".where({ 'm.tenant': tenant, [`m.${cfg.parentCol}`]: parentId })");
    expect(sources.inventoryMaterials).toContain(".where({ tenant, [cfg.parentPk]: input.parent_id })");
    expect(sources.inventoryMaterials).toContain(".where({ tenant, service_id: input.service_id, item_kind: 'product' })");

    expect(sources.checklistItems).toContain("tenantScopedTable(db, 'ticket_checklist_items as tci', tenant)");
    expect(sources.checklistItems).toContain("tenantJoin(");
    expect(sources.checklistItems).toContain("'users as u'");

    expect(sources.sharedChecklistTemplates).toContain("tenantScopedTable(trx, 'checklist_template_apply_rules as r', tenant)");
    expect(sources.sharedChecklistTemplates).toContain("tenantJoin(");
    expect(sources.sharedChecklistTemplates).toContain("'checklist_templates as t'");
  });
});
