import { describe, expect, it } from 'vitest';
import { workflowDateTriggerSchema, workflowDefinitionSchema } from '../types';

describe('workflowDateTriggerSchema', () => {
  it('parses a date trigger and defaults the local time', () => {
    expect(workflowDateTriggerSchema.parse({ type: 'date', source: 'client.anniversary', offsetDays: -30 })).toMatchObject({ localTime: '08:00' });
  });

  it('rejects invalid offsets, times, and extra properties', () => {
    expect(workflowDateTriggerSchema.safeParse({ type: 'date', source: 'client.anniversary', offsetDays: 366 }).success).toBe(false);
    expect(workflowDateTriggerSchema.safeParse({ type: 'date', source: 'client.anniversary', offsetDays: 0, localTime: '24:00' }).success).toBe(false);
    expect(workflowDateTriggerSchema.safeParse({ type: 'date', source: 'client.anniversary', offsetDays: 0, surprise: true }).success).toBe(false);
  });

  it('round-trips a date trigger in a workflow definition', () => {
    const definition = {
      id: 'date-trigger-test',
      version: 1,
      name: 'Anniversary follow-up',
      trigger: { type: 'date', source: 'client.anniversary', offsetDays: -30 },
      payloadSchemaRef: 'payload.ClientAnniversary.v1',
      steps: [],
    };
    const parsed = workflowDefinitionSchema.parse(definition);
    expect(workflowDefinitionSchema.parse(parsed)).toEqual({
      ...definition,
      trigger: { ...definition.trigger, localTime: '08:00' },
    });
  });
});
