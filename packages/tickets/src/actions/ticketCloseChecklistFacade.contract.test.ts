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

  it('keeps migrated ticket helper roots free of handwritten tenant predicates', () => {
    const facadeSources = Object.entries(sources)
      .filter(([name]) => name !== 'inventoryMaterials')
      .map(([, source]) => source);

    for (const source of facadeSources) {
      expect(source).not.toContain('createTenantScopedQuery');
      expect(source).not.toMatch(/\.where\(\{[^}\n]*(?:\btenant\b|['"][^'"]*\.tenant['"])/);
      expect(source).not.toMatch(/\.andWhere\([^)\n]*(?:\btenant\b|['"][^'"]*\.tenant['"])/);
      expect(source).not.toMatch(/\.andOn\([^)\n]*(?:\btenant\b|['"][^'"]*\.tenant['"])/);

      for (const table of coveredTenantTables) {
        expect(source).not.toMatch(directRootPattern(table));
      }
    }

    // Material delegation, authorization and transaction identity are exercised
    // by materialCatalogActions.authorization.test.ts.
  });

  it('uses facade joins for the migrated tenant-table joins', () => {
    // The shared inventory list uses facade-scoped roots and joins; its other
    // paths retain their explicit tenant predicates.
    expect(sources.inventoryMaterials).toContain('const scoped = tenantDb(trx, tenant);');
    expect(sources.inventoryMaterials).toContain('scoped.table(`${cfg.table} as m`)');
    expect(sources.inventoryMaterials).toContain('.where({ [`m.${cfg.parentCol}`]: parentId })');
    expect(sources.inventoryMaterials).toContain("scoped.tenantJoin(query, 'service_catalog as sc', 'm.service_id', 'sc.service_id', { type: 'left' })");
    expect(sources.inventoryMaterials).toContain("scoped.tenantJoin(query, 'product_inventory_settings as pis', 'm.service_id', 'pis.service_id', { type: 'left' })");
    expect(sources.inventoryMaterials).toContain('WHERE sm.tenant = m.tenant AND sm.source_doc_type = ?');
    expect(sources.inventoryMaterials).toContain(".where({ tenant, [cfg.parentPk]: input.parent_id })");
    expect(sources.inventoryMaterials).toContain(".where({ tenant, service_id: input.service_id, item_kind: 'product' })");

    expect(sources.checklistItems).toContain("tenantScopedTable(db, 'ticket_checklist_items as tci', tenant)");
    expect(sources.checklistItems).toContain("tenantJoin(");
    expect(sources.checklistItems).toContain("'users as u'");

  });
});
