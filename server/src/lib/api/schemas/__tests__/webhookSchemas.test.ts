import { describe, expect, it } from 'vitest';

import { webhookEventTypeSchema } from '../webhookSchemas';

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
