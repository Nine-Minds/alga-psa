import { describe, expect, it, vi } from 'vitest';

import { TicketService } from '../../../lib/api/services/TicketService';

function createDocumentsBuilder(rows: unknown[]) {
  const builder = {
    join: vi.fn(() => builder),
    leftJoin: vi.fn(() => builder),
    where: vi.fn(() => builder),
    select: vi.fn(() => builder),
    orderBy: vi.fn().mockResolvedValue(rows),
  };

  return builder;
}

describe('TicketService.getTicketDocuments', () => {
  const ticketId = '123e4567-e89b-12d3-a456-426614174000';
  const context = {
    tenant: 'tenant-1',
    userId: 'user-1',
  } as any;

  it('T010: returns the document list for a ticket', async () => {
    const service = new TicketService();
    const rows = [
      {
        document_id: 'doc-1',
        document_name: 'report.pdf',
        file_id: 'file-1',
        type_name: 'PDF',
        type_icon: 'file-text',
      },
    ];

    const knex = Object.assign(vi.fn((table: string) => {
      if (table === 'documents as d') {
        return createDocumentsBuilder(rows);
      }

      throw new Error(`Unexpected table ${table}`);
    }), {
      raw: vi.fn((value: string) => value),
    }) as any;

    vi.spyOn(service as any, 'getKnex').mockResolvedValue({ knex });

    await expect(service.getTicketDocuments(ticketId, context)).resolves.toEqual(rows);
  });

  it('T011: returns an empty array when a ticket has no documents', async () => {
    const service = new TicketService();
    const knex = Object.assign(vi.fn((table: string) => {
      if (table === 'documents as d') {
        return createDocumentsBuilder([]);
      }

      throw new Error(`Unexpected table ${table}`);
    }), {
      raw: vi.fn((value: string) => value),
    }) as any;

    vi.spyOn(service as any, 'getKnex').mockResolvedValue({ knex });

    await expect(service.getTicketDocuments(ticketId, context)).resolves.toEqual([]);
  });
});
