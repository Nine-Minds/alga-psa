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
    expect(source).toContain(".join('document_associations as da'");
    expect(source).not.toContain("'da.notes as association_notes'");
  });

  it('T063: ticket documents route delegates GET handler to controller.getDocuments', () => {
    const source = readTicketDocumentsRouteSource();

    expect(source).toContain('GET /api/v1/tickets/{id}/documents');
    expect(source).toContain('POST /api/v1/tickets/{id}/documents');
    expect(source).toContain('export const GET = controller.getDocuments();');
    expect(source).toContain('export const POST = controller.uploadDocument();');
  });
});
