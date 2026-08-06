import { describe, expect, it } from 'vitest';
import { workflowClockTriggerPayloadSchema } from '@alga-psa/workflows/runtime/core';
import {
  buildWorkflowClockPayload,
  isClockPinnedSchemaRef,
  WORKFLOW_CLOCK_PAYLOAD_SCHEMA_REF
} from '@alga-psa/workflows/lib/workflowClockPayload';

describe('workflowClockPayload', () => {
  it('builds a clock payload that passes the strict schema and omits display-only fields', () => {
    const payload = buildWorkflowClockPayload({
      scheduleId: 'sched-1',
      workflowId: 'wf-1',
      workflowVersion: 4,
      triggerType: 'recurring',
      scheduledFor: '2026-08-06T06:00:00.000Z',
      cron: '0 6 * * *',
      timezone: 'UTC'
    });

    const parsed = workflowClockTriggerPayloadSchema.safeParse(payload);
    expect(parsed.success).toBe(true);
    expect(workflowClockTriggerPayloadSchema.parse(payload)).toMatchObject({
      triggerType: 'recurring',
      scheduleId: 'sched-1',
      scheduledFor: '2026-08-06T06:00:00.000Z',
      timezone: 'UTC',
      workflowId: 'wf-1',
      workflowVersion: 4,
      cron: '0 6 * * *'
    });
    // .strict() must reject a stray scheduleName; the builder never emits it.
    expect('scheduleName' in payload).toBe(false);
    expect(typeof payload.firedAt).toBe('string');
  });

  it('omits cron and defaults timezone for one-time schedule triggers', () => {
    const payload = buildWorkflowClockPayload({
      scheduleId: 'sched-2',
      workflowId: 'wf-2',
      workflowVersion: 1,
      triggerType: 'schedule',
      scheduledFor: '2026-08-09T10:00:00.000Z',
      timezone: null
    });

    expect(payload).toMatchObject({
      triggerType: 'schedule',
      timezone: 'UTC'
    });
    expect('cron' in payload).toBe(false);
    expect(workflowClockTriggerPayloadSchema.safeParse(payload).success).toBe(true)
  });

  it('falls back to firedAt when scheduledFor is invalid or missing', () => {
    const payload = buildWorkflowClockPayload({
      scheduleId: 'sched-3',
      workflowId: 'wf-3',
      workflowVersion: 2,
      triggerType: 'recurring',
      scheduledFor: 'not-a-date',
      cron: '0 6 * * *',
      timezone: 'UTC'
    });

    expect(payload.scheduledFor).toBe(payload.firedAt);
  });

  it('marks the clock schema ref as clock-pinned and ignores unrelated refs', () => {
    expect(isClockPinnedSchemaRef(WORKFLOW_CLOCK_PAYLOAD_SCHEMA_REF)).toBe(true);
    expect(isClockPinnedSchemaRef('payload.OpportunityStalled.v1')).toBe(false);
    expect(isClockPinnedSchemaRef(null)).toBe(false);
  });
});