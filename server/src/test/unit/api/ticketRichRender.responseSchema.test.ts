import { describe, expect, it } from 'vitest';
import {
  ticketCommentResponseSchema,
  ticketWithDetailsResponseSchema,
} from '../../../lib/api/schemas/ticket';

describe('ticket rich render response schemas', () => {
  it('accepts ticket detail payloads with description_html for mobile rendering', () => {
    const parsed = ticketWithDetailsResponseSchema.parse({
      ticket_id: '11111111-1111-1111-1111-111111111111',
      ticket_number: 'T-1001',
      title: 'Mobile rich description',
      url: null,
      board_id: '22222222-2222-2222-2222-222222222222',
      client_id: '33333333-3333-3333-3333-333333333333',
      location_id: null,
      contact_name_id: null,
      status_id: '44444444-4444-4444-4444-444444444444',
      category_id: null,
      subcategory_id: null,
      entered_by: '55555555-5555-5555-5555-555555555555',
      updated_by: null,
      closed_by: null,
      assigned_to: null,
      entered_at: '2026-03-11T00:00:00.000Z',
      updated_at: null,
      closed_at: null,
      attributes: {
        description: '[{"type":"paragraph","content":[{"type":"text","text":"Rich description","styles":{}}]}]',
      },
      priority_id: '66666666-6666-6666-6666-666666666666',
      tenant: '77777777-7777-7777-7777-777777777777',
      client_name: 'Acme Co',
      status_name: 'Open',
      priority_name: 'High',
      description_html: '<p><strong>Rich</strong> description</p>',
    });

    expect(parsed.description_html).toBe('<p><strong>Rich</strong> description</p>');
  });

  it('accepts ticket comment payloads with comment_html for mobile rendering', () => {
    const parsed = ticketCommentResponseSchema.parse({
      comment_id: '11111111-1111-1111-1111-111111111111',
      ticket_id: '22222222-2222-2222-2222-222222222222',
      comment_text: '[{"type":"paragraph","content":[{"type":"text","text":"Reply","styles":{"bold":true}}]}]',
      comment_html: '<p><strong>Reply</strong></p>',
      is_internal: false,
      time_spent: null,
      created_by: '33333333-3333-3333-3333-333333333333',
      created_at: '2026-03-11T00:00:00.000Z',
      updated_at: null,
      tenant: '44444444-4444-4444-4444-444444444444',
    });

    expect(parsed.comment_html).toBe('<p><strong>Reply</strong></p>');
  });
});
