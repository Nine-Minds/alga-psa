import { describe, expect, it } from 'vitest';
import { ticketCommentResponseSchema } from '../../../lib/api/schemas/ticket';

describe('ticketCommentResponseSchema contact-authored comments', () => {
  it('accepts contact-authored payload with nullable created_by and contact author fields', () => {
    const parsed = ticketCommentResponseSchema.parse({
      comment_id: '11111111-1111-1111-1111-111111111111',
      ticket_id: '22222222-2222-2222-2222-222222222222',
      comment_text: 'Inbound reply',
      is_internal: false,
      time_spent: null,
      created_by: null,
      created_at: '2026-02-11T12:00:00.000Z',
      updated_at: null,
      tenant: '33333333-3333-3333-3333-333333333333',
      contact_id: '44444444-4444-4444-4444-444444444444',
      created_by_name: 'Contact Person',
      author_contact_id: '44444444-4444-4444-4444-444444444444',
      author_contact_name: 'Contact Person',
      author_contact_email: 'contact@example.com',
    });

    expect(parsed.created_by).toBeNull();
    expect(parsed.author_contact_id).toBe('44444444-4444-4444-4444-444444444444');
    expect(parsed.author_contact_name).toBe('Contact Person');
  });

  it('still enforces UUID format when created_by is present', () => {
    expect(() =>
      ticketCommentResponseSchema.parse({
        comment_id: '11111111-1111-1111-1111-111111111111',
        ticket_id: '22222222-2222-2222-2222-222222222222',
        comment_text: 'Inbound reply',
        is_internal: false,
        time_spent: null,
        created_by: 'not-a-uuid',
        created_at: '2026-02-11T12:00:00.000Z',
        updated_at: null,
        tenant: '33333333-3333-3333-3333-333333333333',
      })
    ).toThrow();
  });
});
