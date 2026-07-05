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

describe('ticket service documents and materials tenant-scoped query contract', () => {
  it('uses structural tenant scoping for document and material helper roots', () => {
    const uploadSection = sectionBetween('async uploadTicketDocument', '  async downloadTicketDocument');
    const downloadSection = sectionBetween('async downloadTicketDocument', '  async deleteTicketDocument');
    const deleteSection = sectionBetween('async deleteTicketDocument', '  async getTicketMaterials');
    const materialsSection = sectionBetween('async getTicketMaterials', '  async addTicketMaterial');
    const addMaterialSection = sectionBetween('async addTicketMaterial', '  private async getDocumentById');
    const getDocumentSection = sectionBetween('private async getDocumentById', '  private async getTicketMaterialById');
    const getMaterialSection = sectionBetween('private async getTicketMaterialById', '  private async getDocumentTypeIdForMime');
    const documentTypeSection = sectionBetween('private async getDocumentTypeIdForMime', '  private assertValidTicketId');

    expect(uploadSection).toContain("tenantScopedTable(knex, 'tickets', context.tenant)");
    expect(uploadSection).toContain("tenantScopedTable(knex, 'document_folders', context.tenant)");
    expect(uploadSection).not.toContain('.where({ ticket_id: ticketId, tenant: context.tenant })');
    expect(uploadSection).not.toMatch(/tenant:\s*context\.tenant,\s*entity_id:\s*ticketId,\s*entity_type:\s*'ticket',\s*folder_path:\s*'\/Tickets\/Attachments'/s);

    expect(downloadSection).toContain("tenantScopedTable(knex, 'documents as d', context.tenant)");
    expect(downloadSection).not.toContain("'d.tenant': context.tenant");

    expect(deleteSection).toContain("tenantScopedTable(knex, 'documents as d', context.tenant)");
    expect(deleteSection).toContain("tenantScopedTable(trx, 'document_associations', context.tenant)");
    expect(deleteSection).toContain("tenantScopedTable(trx, 'documents', context.tenant)");
    expect(deleteSection).not.toContain("'d.tenant': context.tenant");
    expect(deleteSection).not.toContain('.where({ association_id: doc.association_id, tenant: context.tenant })');
    expect(deleteSection).not.toContain('.where({ document_id: documentId, tenant: context.tenant })');

    expect(materialsSection).toContain("tenantScopedTable(knex, 'ticket_materials as tm', context.tenant)");
    expect(materialsSection).not.toContain("'tm.tenant': context.tenant");

    expect(addMaterialSection).toContain("tenantScopedTable(knex, 'tickets', context.tenant)");
    expect(addMaterialSection).toContain("tenantScopedTable(knex, 'service_catalog', context.tenant)");
    expect(addMaterialSection).not.toContain('.where({ ticket_id: ticketId, tenant: context.tenant })');
    expect(addMaterialSection).not.toMatch(/\.where\(\{\s*tenant:\s*context\.tenant,\s*service_id:\s*data\.service_id/s);

    expect(getDocumentSection).toContain("tenantScopedTable(knex, 'documents as d', context.tenant)");
    expect(getDocumentSection).not.toContain("'d.tenant': context.tenant");

    expect(getMaterialSection).toContain("tenantScopedTable(knex, 'ticket_materials as tm', context.tenant)");
    expect(getMaterialSection).not.toContain("'tm.tenant': context.tenant");

    expect(documentTypeSection).toContain("tenantScopedTable(knex, 'document_types', tenant)");
    expect(documentTypeSection).not.toContain('.where({ tenant, type_name: mimeType })');
    expect(documentTypeSection).not.toContain('.where({ tenant, type_name: generalType })');
  });
});
