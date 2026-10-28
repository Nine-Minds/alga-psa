import { describe, expect, it } from 'vitest';

import {
  createWebhookSchema,
  updateWebhookSchema,
  webhookEventTypeSchema,
  webhookResponseSchema,
} from '../webhookSchemas';
import { WEBHOOK_EVENT_NAMES } from '../../../webhooks/eventRegistry';

describe('webhookEventTypeSchema', () => {
  it('accepts ticket.comment.added', () => {
    expect(webhookEventTypeSchema.safeParse('ticket.comment.added').success).toBe(true);
  });

  it('accepts all project webhook events and the deprecated project.completed alias', () => {
    for (const eventType of [
      'project.created',
      'project.updated',
      'project.status_changed',
      'project.assigned',
      'project.closed',
      'project.completed',
      'project.task.created',
      'project.task.updated',
      'project.task.status_changed',
      'project.task.assigned',
      'project.task.completed',
    ]) {
      expect(webhookEventTypeSchema.safeParse(eventType).success).toBe(true);
    }
  });
});

describe('webhookEventTypeSchema: client, contact and client_location events', () => {
  it('accepts all 12 new events', () => {
    for (const entity of ['client', 'contact', 'client_location']) {
      for (const action of ['created', 'updated', 'deactivated', 'deleted']) {
        expect(webhookEventTypeSchema.safeParse(`${entity}.${action}`).success, `${entity}.${action}`).toBe(true);
      }
    }
  });

  it('rejects *.archived aliases and retired names', () => {
    for (const name of ['client.archived', 'contact.archived', 'time.entry.created', 'invoice.created', 'asset.created', 'system.backup.completed', 'workflow.execution.started', 'custom.event']) {
      expect(webhookEventTypeSchema.safeParse(name).success, name).toBe(false);
    }
  });

  it('enum options are exactly the registry', () => {
    expect([...webhookEventTypeSchema.options].sort()).toEqual([...WEBHOOK_EVENT_NAMES].sort());
  });
});

describe('legacy event types in webhook schemas', () => {
  const base = { name: 'n', url: 'https://example.test/h', security: { type: 'none' } };

  // Only the event_types issues matter here; other required fields are irrelevant to this contract.
  const eventTypeIssues = (event_types: string[]) => {
    const r = createWebhookSchema.safeParse({ ...base, event_types });
    return r.success ? [] : r.error.issues.filter((i) => i.path[0] === 'event_types');
  };

  it('create rejects an unknown/legacy event type', () => {
    expect(eventTypeIssues(['invoice.created']).length).toBeGreaterThan(0);
    expect(eventTypeIssues(['ticket.created', 'custom.event']).length).toBeGreaterThan(0);
    expect(eventTypeIssues(['client.created', 'contact.deleted', 'client_location.updated'])).toEqual([]);
  });

  it('update schema parses legacy names (the service decides which are allowed)', () => {
    expect(updateWebhookSchema.safeParse({ event_types: ['invoice.created', 'ticket.created'] }).success).toBe(true);
    expect(updateWebhookSchema.safeParse({ event_types: [] }).success).toBe(false);
  });

  it('response schema never fails on stored legacy names', () => {
    const shape = webhookResponseSchema.shape.event_types;
    expect(shape.safeParse(['time.entry.created', 'workflow.execution.started']).success).toBe(true);
  });
});
