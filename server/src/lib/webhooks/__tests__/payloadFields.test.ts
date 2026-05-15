import { describe, expect, it } from 'vitest';

import {
  payloadFieldsByEntitySchema,
  projectWebhookPayload,
  WEBHOOK_PAYLOAD_FIELDS_BY_ENTITY,
} from '../payloadFields';

describe('webhook payload fields', () => {
  it('validates field selections against the shared entity registry', () => {
    expect(
      payloadFieldsByEntitySchema.safeParse({
        ticket: ['title', 'comments'],
      }).success,
    ).toBe(true);

    expect(
      payloadFieldsByEntitySchema.safeParse({
        invoice: ['invoice_number'],
      }).success,
    ).toBe(false);

    expect(
      payloadFieldsByEntitySchema.safeParse({
        ticket: ['not_a_ticket_field'],
      }).success,
    ).toBe(false);
  });

  it('projects payloads while retaining always-included entity keys', () => {
    expect(WEBHOOK_PAYLOAD_FIELDS_BY_ENTITY.ticket).toContain('title');

    const projected = projectWebhookPayload(
      'ticket',
      {
        ticket_id: 'ticket-1',
        title: 'Printer issue',
        client_name: 'Acme',
      },
      ['title'],
    );

    expect(projected).toEqual({
      ticket_id: 'ticket-1',
      title: 'Printer issue',
    });
  });
});
