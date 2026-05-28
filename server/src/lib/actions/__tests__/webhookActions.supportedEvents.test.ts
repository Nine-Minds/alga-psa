import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(path.resolve(__dirname, '../webhookActions.ts'), 'utf8');

describe('SUPPORTED_WEBHOOK_EVENTS project metadata', () => {
  it('contains every project event accepted by webhook creation and listWebhookEvents', () => {
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
      expect(source).toContain(`'${eventType}'`);
    }

    expect(source).toContain('eventTypes: z.array(z.enum(SUPPORTED_WEBHOOK_EVENTS)).min(1)');
    expect(source).toContain('return [...SUPPORTED_WEBHOOK_EVENTS];');
  });
});
