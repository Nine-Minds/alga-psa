import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ticketCommentResponseSchema } from '../../../lib/api/schemas/ticket';

function readTicketServiceSource(): string {
  const filePath = path.resolve(__dirname, '../../../lib/api/services/TicketService.ts');
  return fs.readFileSync(filePath, 'utf8');
}

describe('TicketService ticket comments contact authorship contract', () => {
  it('T032: getTicketComments maps contact author fields and nullable created_by', () => {
    const source = readTicketServiceSource();

    expect(source).toContain(".leftJoin('contacts as c'");
    expect(source).toContain("'c.contact_name_id as author_contact_id'");
    expect(source).toContain("'c.full_name as author_contact_name'");
    expect(source).toContain("'c.email as author_contact_email'");
    expect(source).toContain('created_by: comment.user_id ?? null');
    expect(source).toContain('author_contact_id: comment.author_contact_id || comment.contact_id || null');
  });

  it('T034: contact-authored ticket comment payload parses without response validation errors', () => {
    const payload = {
      comment_id: '11111111-1111-1111-1111-111111111111',
      ticket_id: '22222222-2222-2222-2222-222222222222',
      comment_text: 'Inbound contact reply',
      is_internal: false,
      time_spent: null,
      created_by: null,
      created_at: '2026-02-11T00:00:00.000Z',
      updated_at: null,
      tenant: '33333333-3333-3333-3333-333333333333',
      contact_id: '44444444-4444-4444-4444-444444444444',
      created_by_name: 'Contact Author',
      author_contact_id: '44444444-4444-4444-4444-444444444444',
      author_contact_name: 'Contact Author',
      author_contact_email: 'contact.author@example.com',
    };

    const parsed = ticketCommentResponseSchema.parse(payload);
    expect(parsed.created_by).toBeNull();
    expect(parsed.author_contact_id).toBe('44444444-4444-4444-4444-444444444444');
  });
});
