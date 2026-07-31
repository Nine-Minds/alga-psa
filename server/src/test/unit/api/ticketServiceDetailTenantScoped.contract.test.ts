import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const servicePath = resolve(__dirname, '../../../lib/api/services/TicketService.ts');
const source = readFileSync(servicePath, 'utf8');

function sectionBetween(startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);

  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);

  return source.slice(start, end);
}

describe('ticket service detail tenant-scoped query contract', () => {
  it('uses structural tenant scoping for detail, asset link, and delete roots', () => {
    const deleteSection = sectionBetween('async delete(', '  /**\n   * List tickets');
    const tagsSection = sectionBetween('private async attachTicketTags', '  private normalizeTicketListFields');
    const detailSection = sectionBetween('async getById', '  async getTicketDocuments');
    const documentsSection = sectionBetween('async getTicketDocuments', '  /**\n   * List assets linked');
    const assetsSection = sectionBetween('async getTicketAssets', '  /**\n   * Link an asset');
    const linkSection = sectionBetween('async linkAsset', '  /**\n   * Remove the asset_associations');
    const unlinkSection = sectionBetween('async unlinkAsset', '  async uploadTicketDocument');

    expect(source).toContain('function tenantScopedTable(');

    expect(deleteSection).toContain("tenantScopedTable(trx, 'tickets', tenant)");
    expect(deleteSection).not.toContain('.where({ ticket_id: id, tenant })');

    expect(tagsSection).toContain("tenantScopedTable(knex, 'tag_mappings as tm', tenant)");
    expect(tagsSection).not.toContain(".where('tm.tenant', tenant)");

    expect(detailSection).toContain("tenantScopedTable(knex, 'tickets as t', context.tenant)");
    expect(detailSection).not.toContain(".where({ 't.ticket_id': id, 't.tenant': context.tenant })");

    expect(documentsSection).toContain("tenantScopedTable(knex, 'documents as d', context.tenant)");
    expect(documentsSection).not.toContain("'da.tenant': context.tenant");
    expect(documentsSection).not.toContain("'d.tenant': context.tenant");

    expect(assetsSection).toContain("tenantScopedTable(knex, 'asset_associations as aa', context.tenant)");
    expect(assetsSection).not.toContain("'aa.tenant': context.tenant");
    expect(assetsSection).not.toContain("'a.tenant': context.tenant");

    expect(linkSection).toContain("tenantScopedTable(knex, 'tickets', context.tenant)");
    expect(linkSection).toContain("tenantScopedTable(knex, 'assets', context.tenant)");
    expect(linkSection).toContain("tenantScopedTable(knex, 'asset_associations', context.tenant)");
    expect(linkSection).not.toMatch(/\.where\(\{\s*tenant:\s*context\.tenant,\s*ticket_id:\s*ticketId\s*\}\)/);
    expect(linkSection).not.toMatch(/\.where\(\{\s*tenant:\s*context\.tenant,\s*asset_id:\s*data\.asset_id\s*\}\)/);
    expect(linkSection).not.toMatch(/\.where\(\{\s*tenant:\s*context\.tenant,\s*asset_id:\s*data\.asset_id,\s*entity_id:\s*ticketId/s);

    expect(unlinkSection).toContain("tenantScopedTable(knex, 'asset_associations', context.tenant)");
    expect(unlinkSection).not.toMatch(/\.where\(\{\s*tenant:\s*context\.tenant,\s*asset_id:\s*assetId/s);
  });
});
