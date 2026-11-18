import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(path.resolve(__dirname, '../webhookActions.ts'), 'utf8');
// The event list lives in the registry (server/src/lib/webhooks/eventRegistry.ts);
// deliveryRetry.ts re-exports it as SUPPORTED_WEBHOOK_EVENTS because a
// 'use server' file may only export async functions.
const registrySource = readFileSync(
  path.resolve(__dirname, '../../webhooks/eventRegistry.ts'),
  'utf8',
);
const retrySource = readFileSync(
  path.resolve(__dirname, '../../webhooks/deliveryRetry.ts'),
  'utf8',
);

describe('webhook event metadata is registry-derived', () => {
  it('registry declares every project event', () => {
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
      expect(registrySource).toContain(`'${eventType}'`);
    }
  });

  it('retry module derives SUPPORTED_WEBHOOK_EVENTS from the registry', () => {
    expect(retrySource).toContain('export const SUPPORTED_WEBHOOK_EVENTS = WEBHOOK_EVENT_NAMES');
  });

  it('admin actions list registry events and validate against the registry, not a hard-coded enum', () => {
    expect(source).toContain('return [...WEBHOOK_EVENT_NAMES];');
    expect(source).toContain('disallowedEventTypes');
    expect(source).not.toMatch(/z\.enum\(SUPPORTED_WEBHOOK_EVENTS\)/);
  });
});
