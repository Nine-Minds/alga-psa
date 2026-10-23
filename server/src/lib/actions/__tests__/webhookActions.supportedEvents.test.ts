import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(path.resolve(__dirname, '../webhookActions.ts'), 'utf8');
// SUPPORTED_WEBHOOK_EVENTS lives in the shared retry module because a
// 'use server' file may only export async functions.
const eventSource = readFileSync(
  path.resolve(__dirname, '../../webhooks/deliveryRetry.ts'),
  'utf8',
);

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
      expect(eventSource).toContain(`'${eventType}'`);
    }

    expect(source).toMatch(
      /import \{[^}]*\bSUPPORTED_WEBHOOK_EVENTS\b[^}]*\} from '@\/lib\/webhooks\/deliveryRetry';/,
    );
    expect(eventSource).toContain('export const SUPPORTED_WEBHOOK_EVENTS = [');
    expect(source).toContain('eventTypes: z.array(z.enum(SUPPORTED_WEBHOOK_EVENTS)).min(1)');
    expect(source).toContain('return [...SUPPORTED_WEBHOOK_EVENTS];');
  });
});
