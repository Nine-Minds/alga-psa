import { describe, expect, it } from 'vitest';

import {
  applyPayloadAllowlist,
  ALWAYS_INCLUDED_KEYS_BY_ENTITY,
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

    const unknownEntity = payloadFieldsByEntitySchema.safeParse({
      invoice: ['invoice_number'],
    });
    expect(unknownEntity.success).toBe(false);
    expect(unknownEntity.error?.issues[0]).toEqual(expect.objectContaining({
      params: {
        messageKey: 'msp/profile:errors.webhooks.validation.unknownEntity',
        messageParams: { entity: 'invoice' },
      },
    }));

    expect(
      payloadFieldsByEntitySchema.safeParse({
        ticket: ['not_a_ticket_field'],
      }).success,
    ).toBe(false);

    expect(
      payloadFieldsByEntitySchema.safeParse({
        project: ['project_name', 'phases', 'task_name', 'tags'],
      }).success,
    ).toBe(true);

    expect(
      payloadFieldsByEntitySchema.safeParse({
        project: ['not_a_project_field'],
      }).success,
    ).toBe(false);
  });

  it('projects payloads while retaining always-included entity keys', () => {
    expect(WEBHOOK_PAYLOAD_FIELDS_BY_ENTITY.ticket).toContain('title');
    expect(WEBHOOK_PAYLOAD_FIELDS_BY_ENTITY.project).toContain('project_name');
    expect(WEBHOOK_PAYLOAD_FIELDS_BY_ENTITY.project).toContain('task_name');
    expect(WEBHOOK_PAYLOAD_FIELDS_BY_ENTITY.project).toContain('phases');
    expect(WEBHOOK_PAYLOAD_FIELDS_BY_ENTITY.project).toContain('task_counts');
    expect(WEBHOOK_PAYLOAD_FIELDS_BY_ENTITY.project).toContain('tags');
    expect(WEBHOOK_PAYLOAD_FIELDS_BY_ENTITY.project).not.toContain('project_id');
    expect(ALWAYS_INCLUDED_KEYS_BY_ENTITY.project).toEqual(['project_id']);

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
      project_id: 'project-1',
      task_name: 'Plan rollout',
    });

    expect(
      applyPayloadAllowlist('project', payload, ['task_name'], ['task_id']),
    ).toEqual({
      project_id: 'project-1',
      task_id: 'task-1',
      task_name: 'Plan rollout',
    });
  });
});

describe('client / contact / client_location payload fields', () => {
  it('registers allowlist entities and accepts their selectable fields', () => {
    expect(WEBHOOK_PAYLOAD_FIELDS_BY_ENTITY.client).toBeDefined();
    expect(payloadFieldsByEntitySchema.safeParse({ contact: ['client_id', 'changed_fields'] }).success).toBe(true);
    expect(payloadFieldsByEntitySchema.safeParse({ client_location: ['client_id'] }).success).toBe(true);
    expect(payloadFieldsByEntitySchema.safeParse({ contact: ['email'] }).success).toBe(false);
  });

  it('always keeps the entity id, even with an empty selection', () => {
    expect(ALWAYS_INCLUDED_KEYS_BY_ENTITY.client).toEqual(['client_id']);
    expect(ALWAYS_INCLUDED_KEYS_BY_ENTITY.contact).toEqual(['contact_id']);
    expect(ALWAYS_INCLUDED_KEYS_BY_ENTITY.client_location).toEqual(['location_id']);
    expect(
      applyPayloadAllowlist('contact', { contact_id: 'c', client_id: 'k', changed_fields: ['x'] }, []),
    ).toEqual({ contact_id: 'c' });
  });
});
