import { describe, expect, it } from 'vitest';
import {
  createInteractionApiSchema,
  interactionListQuerySchema,
} from '../../../lib/api/schemas/interactionSchemas';

describe('interaction REST schemas', () => {
  it('T010: accepts a Call payload linked to an opportunity, client, and contact', () => {
    expect(createInteractionApiSchema.parse({
      type_id: '11111111-1111-4111-8111-111111111111',
      client_id: '22222222-2222-4222-8222-222222222222',
      contact_name_id: '33333333-3333-4333-8333-333333333333',
      opportunity_id: '44444444-4444-4444-8444-444444444444',
      title: 'Discovery call',
      notes: 'Discussed rollout timing',
      duration: 20,
      interaction_date: '2026-07-16T14:30:00.000Z',
    })).toEqual({
      type_id: '11111111-1111-4111-8111-111111111111',
      client_id: '22222222-2222-4222-8222-222222222222',
      contact_name_id: '33333333-3333-4333-8333-333333333333',
      opportunity_id: '44444444-4444-4444-8444-444444444444',
      title: 'Discovery call',
      notes: 'Discussed rollout timing',
      duration: 20,
      interaction_date: '2026-07-16T14:30:00.000Z',
    });
  });

  it('T010: rejects a payload without type_id', () => {
    expect(createInteractionApiSchema.safeParse({
      client_id: '22222222-2222-4222-8222-222222222222',
      title: 'Discovery call',
    }).success).toBe(false);
  });

  it('T010: requires a client or contact link', () => {
    expect(createInteractionApiSchema.safeParse({
      type_id: '11111111-1111-4111-8111-111111111111',
    }).success).toBe(false);
  });

  it('T010: accepts every documented list filter and caps page size', () => {
    expect(interactionListQuerySchema.parse({
      client_id: '11111111-1111-4111-8111-111111111111',
      contact_id: '22222222-2222-4222-8222-222222222222',
      opportunity_id: '33333333-3333-4333-8333-333333333333',
      ticket_id: '44444444-4444-4444-8444-444444444444',
      project_id: '55555555-5555-4555-8555-555555555555',
      user_id: '66666666-6666-4666-8666-666666666666',
      type_id: '77777777-7777-4777-8777-777777777777',
      date_from: '2026-07-01T00:00:00.000Z',
      date_to: '2026-07-31T23:59:59.999Z',
      page: '2',
      page_size: '500',
    })).toEqual({
      client_id: '11111111-1111-4111-8111-111111111111',
      contact_id: '22222222-2222-4222-8222-222222222222',
      opportunity_id: '33333333-3333-4333-8333-333333333333',
      ticket_id: '44444444-4444-4444-8444-444444444444',
      project_id: '55555555-5555-4555-8555-555555555555',
      user_id: '66666666-6666-4666-8666-666666666666',
      type_id: '77777777-7777-4777-8777-777777777777',
      date_from: '2026-07-01T00:00:00.000Z',
      date_to: '2026-07-31T23:59:59.999Z',
      page: 2,
      page_size: 100,
    });
  });
});
