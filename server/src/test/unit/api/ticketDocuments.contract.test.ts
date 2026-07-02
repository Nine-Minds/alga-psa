import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function readTicketServiceSource(): string {
  const filePath = path.resolve(__dirname, '../../../lib/api/services/TicketService.ts');
  return fs.readFileSync(filePath, 'utf8');
}

function readTicketDocumentsRouteSource(): string {
  const filePath = path.resolve(__dirname, '../../../app/api/v1/tickets/[id]/documents/route.ts');
  return fs.readFileSync(filePath, 'utf8');
}

function readTicketDocumentByIdRouteSource(): string {
  const filePath = path.resolve(__dirname, '../../../app/api/v1/tickets/[id]/documents/[documentId]/route.ts');
  return fs.readFileSync(filePath, 'utf8');
}

describe('Ticket documents API contract', () => {
  it('T061: getById enriches tickets with associated documents', () => {
    const source = readTicketServiceSource();

    expect(source).toContain('this.getTicketDocuments(id, context)');
    expect(source).toContain('const [documents, contactAvatarUrl, clientLogoUrl] = await Promise.all([');
    expect(source).toContain('documents,');
  });

  it('T062: getTicketDocuments filters document associations for ticket entity type', () => {
    const source = readTicketServiceSource();

    expect(source).toContain("async getTicketDocuments(ticketId: string, context: ServiceContext): Promise<IDocument[]>");
    expect(source).toContain("'da.entity_type': 'ticket'");
    // Tenant scoping now lives in the tenantDb facade: the documents read is
    // facade-scoped and the association join is tenant-matched via tenantJoin.
    expect(source).toContain('return tenantDb(conn, tenant).table(table);');
    expect(source).toContain("const documentQuery = tenantScopedTable(knex, 'documents as d', context.tenant);");
    expect(source).toContain("scopedDb.tenantJoin(documentQuery, 'document_associations as da', 'd.document_id', 'da.document_id');");
    expect(source).not.toContain("'da.notes as association_notes'");
  });

  it('T063: ticket documents route delegates GET handler to controller.getDocuments', () => {
    const source = readTicketDocumentsRouteSource();

    expect(source).toContain('GET /api/v1/tickets/{id}/documents');
    expect(source).toContain('POST /api/v1/tickets/{id}/documents');
    expect(source).toContain('export const GET = controller.getDocuments();');
    expect(source).toContain('export const POST = controller.uploadDocument();');
  });

  it('T064: ticket document by ID route delegates DELETE handler to controller.deleteDocument', () => {
    const source = readTicketDocumentByIdRouteSource();

    expect(source).toContain('DELETE /api/v1/tickets/{id}/documents/{documentId}');
    expect(source).toContain('export const DELETE = controller.deleteDocument();');
  });

  it('T065: deleteTicketDocument removes association and cleans up orphaned documents', () => {
    const source = readTicketServiceSource();

    expect(source).toContain('async deleteTicketDocument(');
    expect(source).toContain("'da.entity_type': 'ticket'");
    // Removes the association (tenant-scoped via the tenantDb-backed table helper)
    expect(source).toContain(
      "await tenantScopedTable(trx, 'document_associations', context.tenant)\n        .where({ association_id: doc.association_id })\n        .del();"
    );
    // Checks for remaining associations before deleting the document
    expect(source).toContain("const remaining = await tenantScopedTable(trx, 'document_associations', context.tenant)");
    expect(source).toContain("Number(remaining.count) === 0");
  });
});
