/** @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { applyDateTriggerTiming, describeDateTriggerPayloadField, localTodayIsoDate, toRunDialogDateTrigger } from '../workflowRunDateTrigger';
import {
  buildWorkflowRunDraftFormKey,
  clearWorkflowRunDraft,
  readWorkflowRunDraft,
  saveWorkflowRunDraft,
} from '../workflowRunDraftStore';

const t = ((key: string, options?: Record<string, unknown>) =>
  String(options?.defaultValue ?? key).replace(/\{\{(\w+)\}\}/g, (_m, name) => String(options?.[name] ?? ''))) as never;

describe('date trigger test payloads', () => {
  it('reads the date trigger of a definition', () => {
    expect(toRunDialogDateTrigger({ type: 'date', source: 'contract.end', offsetDays: -30 })).toEqual({ source: 'contract.end', offsetDays: -30 });
    expect(toRunDialogDateTrigger({ type: 'event', eventName: 'TICKET_CREATED' })).toBeNull();
    expect(toRunDialogDateTrigger({ type: 'date', source: 'unknown.source', offsetDays: 1 })).toBeNull();
  });

  it('fills the timing from the trigger and record, never over what the person typed', () => {
    const trigger = { source: 'contract.end' as const, offsetDays: -30 };
    const fromRecord = applyDateTriggerTiming({ contractId: 'c1' }, {
      trigger,
      record: { end_date: '2026-12-08' },
      today: '2026-10-03',
      canOverwrite: () => true,
    });
    expect(fromRecord).toMatchObject({ occursOn: '2026-12-08', endDate: '2026-12-08', offsetDays: -30, fireDate: '2026-11-08' });

    // The person set the offset to -7 themselves: the fire date follows their offset.
    const typedOffset = applyDateTriggerTiming({ occursOn: '2026-12-08', offsetDays: -7 }, {
      trigger,
      today: '2026-10-03',
      canOverwrite: (key) => key !== 'offsetDays',
    });
    expect(typedOffset).toMatchObject({ offsetDays: -7, fireDate: '2026-12-01' });

    // A typed fire date stays.
    const typedFireDate = applyDateTriggerTiming({ occursOn: '2026-12-08', fireDate: '2026-01-01' }, {
      trigger,
      today: '2026-10-03',
      canOverwrite: (key) => key !== 'fireDate',
    });
    expect(typedFireDate.fireDate).toBe('2026-01-01');
  });

  it('carries the status-age params and derives the timing from the ticket record', () => {
    const params = { statusName: 'Waiting for client', days: 7 };
    const trigger = toRunDialogDateTrigger({ type: 'date', source: 'ticket.status_age', offsetDays: 0, params });
    expect(trigger).toEqual({ source: 'ticket.status_age', offsetDays: 0, params });

    const payload = applyDateTriggerTiming({ ticketId: 't1' }, {
      trigger: trigger!,
      record: { status_changed_at: '2026-09-10T09:00:00.000Z' },
      today: '2026-09-12',
      canOverwrite: () => true,
    });
    expect(payload).toMatchObject({ occursOn: '2026-09-17', fireDate: '2026-09-17', offsetDays: 0 });

    // A different threshold moves the date: the params, not just the source, drive the math.
    const longer = applyDateTriggerTiming({}, {
      trigger: { ...trigger!, params: { ...params, days: 14 } },
      record: { status_changed_at: '2026-09-10T09:00:00.000Z' },
      today: '2026-09-12',
      canOverwrite: () => true,
    });
    expect(longer.occursOn).toBe('2026-09-24');
    expect(describeDateTriggerPayloadField(t, 'occursOn', trigger!)).toContain('number of days in status');
  });

  it('explains the timing fields in plain words', () => {
    const trigger = { source: 'client.anniversary' as const, offsetDays: 14 };
    expect(describeDateTriggerPayloadField(t, 'occursOn', trigger)).toMatch(/the client's next anniversary/);
    expect(describeDateTriggerPayloadField(t, 'offsetDays', trigger)).toMatch(/14 days after/);
    expect(describeDateTriggerPayloadField(t, 'clientId', trigger)).toBeNull();
    expect(localTodayIsoDate(new Date(2026, 0, 5))).toBe('2026-01-05');
  });
});

describe('Run dialog drafts', () => {
  afterEach(() => {
    clearWorkflowRunDraft('wf');
    vi.restoreAllMocks();
  });

  it('keeps one draft per workflow and form', () => {
    const formKey = buildWorkflowRunDraftFormKey('payload', 'payload.ContractEndDate.v1');
    saveWorkflowRunDraft('wf', { formKey, payload: { clientName: 'Acme' }, editedPaths: ['["clientName"]'] });
    expect(readWorkflowRunDraft('wf', formKey)?.payload).toEqual({ clientName: 'Acme' });
    // A draft typed into another form is not restored into this one.
    expect(readWorkflowRunDraft('wf', buildWorkflowRunDraftFormKey('event', 'payload.Other.v1', 'X'))).toBeNull();
    clearWorkflowRunDraft('wf');
    expect(readWorkflowRunDraft('wf', formKey)).toBeNull();
  });

  it('falls back to memory when session storage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    const formKey = buildWorkflowRunDraftFormKey('payload', 'p');
    saveWorkflowRunDraft('wf', { formKey, payload: { a: 1 }, editedPaths: [] });
    expect(readWorkflowRunDraft('wf', formKey)?.payload).toEqual({ a: 1 });
  });
});
