import { describe, expect, it } from 'vitest';

import {
  applyPayloadAllowlist,
  payloadFieldsByEntitySchema,
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

    const projected = applyPayloadAllowlist(
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

  it('returns the original payload when no allowlist is configured', () => {
    const payload = {
      ticket_id: 'ticket-1',
      title: 'Printer issue',
      client_name: 'Acme',
    };

    expect(applyPayloadAllowlist('ticket', payload, null)).toBe(payload);
  });

  it('retains extra always-included keys when projecting a subset', () => {
    const payload = {
      project_id: 'project-1',
      task_id: 'task-1',
      task_name: 'Plan rollout',
      internal_note: 'not selectable',
    };

    expect(applyPayloadAllowlist('project', payload, ['task_name'])).toEqual({
      task_name: 'Plan rollout',
    });

    expect(
      applyPayloadAllowlist('project', payload, ['task_name'], ['task_id']),
    ).toEqual({
      task_id: 'task-1',
      task_name: 'Plan rollout',
    });
  });
});
