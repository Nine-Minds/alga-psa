import { describe, expect, it } from 'vitest';
import {
  DATE_TRIGGER_SOURCE_IDS,
  dateTriggerSourceDefinitions,
  getDateTriggerSourceDefinition,
} from '../dateTriggerSourceDefinitions';
import { canonicalizeDateTriggerParams, validateDateTriggerParams } from '../dateTriggerParams';
import { DATE_TRIGGER_OCCURRENCE_RULES, computeStatusAgeOccurrence, deriveDateTriggerTiming } from '../dateTriggerOccurrence';
import { dateTriggerPayloadSchemaRefs, dateTriggerPayloadSchemas } from '../schemas/dateTriggerPayloadSchemas';
import { workflowDateTriggerSchema, workflowDateTriggerWithParamsSchema } from '../types';
import { validateWorkflowDefinition } from '../validation/publishValidation';

const params = { statusName: 'Waiting for client', days: 7 };

describe('date trigger source definitions', () => {
  it('derives the zod enum, ref map and occurrence rules from one list', () => {
    expect([...DATE_TRIGGER_SOURCE_IDS]).toEqual(dateTriggerSourceDefinitions.map((d) => d.id));
    for (const definition of dateTriggerSourceDefinitions) {
      expect(dateTriggerPayloadSchemaRefs[definition.id]).toBe(definition.payloadSchemaRef);
      expect(dateTriggerPayloadSchemas[definition.payloadSchemaRef]).toBeDefined();
      expect(DATE_TRIGGER_OCCURRENCE_RULES[definition.id]).toBeDefined();
      expect(workflowDateTriggerSchema.safeParse({ type: 'date', source: definition.id, offsetDays: 0 }).success).toBe(true);
    }
  });

  it('marks ticket.status_age as a condition source with params and no offset', () => {
    expect(getDateTriggerSourceDefinition('ticket.status_age')).toMatchObject({
      mode: 'condition', recurrence: 'repeating', hasParams: true, usesOffset: false, payloadSchemaRef: 'payload.TicketStatusAge.v1',
    });
    for (const id of ['client.anniversary', 'contract.renewal_decision', 'contract.end', 'asset.warranty_end']) {
      expect(getDateTriggerSourceDefinition(id)).toMatchObject({ mode: 'window', hasParams: false, usesOffset: true });
    }
  });
});

describe('date trigger params', () => {
  it('accepts old definitions without params and with params', () => {
    expect(workflowDateTriggerSchema.safeParse({ type: 'date', source: 'client.anniversary', offsetDays: -30 }).success).toBe(true);
    expect(workflowDateTriggerSchema.safeParse({ type: 'date', source: 'ticket.status_age', offsetDays: 0, params }).success).toBe(true);
  });

  it('validates ticket.status_age params and returns the normal form', () => {
    expect(validateDateTriggerParams('ticket.status_age', { ...params, repeatEveryDays: 3, requireNoActivity: true })).toEqual({
      ok: true, issues: [], params: { statusName: 'waiting for client', boardId: null, days: 7, repeatEveryDays: 3, requireNoActivity: true },
    });
    for (const bad of [undefined, {}, { statusName: '', days: 7 }, { ...params, days: 0 }, { ...params, days: 366 }, { ...params, days: 1.5 },
      { ...params, repeatEveryDays: 0 }, { ...params, boardId: 'not-a-uuid' }, { ...params, extra: 1 }]) {
      expect(validateDateTriggerParams('ticket.status_age', bad).ok).toBe(false);
    }
    expect(validateDateTriggerParams('client.anniversary', { days: 1 }).ok).toBe(false);
    expect(validateDateTriggerParams('client.anniversary', undefined).ok).toBe(true);
  });

  it('refines per source outside the discriminated union', () => {
    expect(workflowDateTriggerWithParamsSchema.safeParse({ type: 'date', source: 'ticket.status_age', offsetDays: 0 }).success).toBe(false);
    expect(workflowDateTriggerWithParamsSchema.safeParse({ type: 'date', source: 'ticket.status_age', offsetDays: 3, params }).success).toBe(false);
    expect(workflowDateTriggerWithParamsSchema.safeParse({ type: 'date', source: 'ticket.status_age', offsetDays: 0, params }).success).toBe(true);
  });

  it('canonicalizes params independent of key order', () => {
    expect(canonicalizeDateTriggerParams({ b: 1, a: { d: 2, c: null } })).toBe(canonicalizeDateTriggerParams({ a: { c: null, d: 2 }, b: 1 }));
  });
});

describe('computeStatusAgeOccurrence', () => {
  it('first fire is the anchor date plus N days, and not before', () => {
    expect(computeStatusAgeOccurrence({ anchorDate: '2026-09-01', days: 7, today: '2026-09-07' })).toEqual({ occursOn: '2026-09-08', repeatIndex: 0, due: false });
    expect(computeStatusAgeOccurrence({ anchorDate: '2026-09-01', days: 7, today: '2026-09-08' })).toEqual({ occursOn: '2026-09-08', repeatIndex: 0, due: true });
    // No repeat: still the one occurrence a month later.
    expect(computeStatusAgeOccurrence({ anchorDate: '2026-09-01', days: 7, today: '2026-10-07' })).toEqual({ occursOn: '2026-09-08', repeatIndex: 0, due: true });
  });

  it('repeats at N, N+R, N+2R and collapses missed periods to the latest', () => {
    const at = (today: string) => computeStatusAgeOccurrence({ anchorDate: '2026-09-01', days: 7, repeatEveryDays: 3, today });
    expect(at('2026-09-08')).toMatchObject({ occursOn: '2026-09-08', repeatIndex: 0 });
    expect(at('2026-09-10')).toMatchObject({ occursOn: '2026-09-08', repeatIndex: 0 });
    expect(at('2026-09-11')).toMatchObject({ occursOn: '2026-09-11', repeatIndex: 1 });
    expect(at('2026-09-14')).toMatchObject({ occursOn: '2026-09-14', repeatIndex: 2 });
    // Ten days of missed scans: only the latest period.
    expect(at('2026-09-24')).toMatchObject({ occursOn: '2026-09-23', repeatIndex: 5 });
  });

  it('rejects bad input', () => {
    expect(computeStatusAgeOccurrence({ anchorDate: 'nope', days: 7, today: '2026-09-08' })).toBeNull();
  });
});

describe('ticket.status_age occurrence rule (Run dialog)', () => {
  it('derives timing, repeat index and days in status from a ticket record', () => {
    const derived = deriveDateTriggerTiming({
      source: 'ticket.status_age', offsetDays: 0, params: { ...params, repeatEveryDays: 3 }, payload: {}, today: '2026-09-14',
      record: { status_changed_at: '2026-09-01T09:00:00.000Z' },
    });
    expect(derived).toMatchObject({ occursOn: '2026-09-14', fireDate: '2026-09-14', offsetDays: 0, repeatIndex: 2, daysInStatus: 13 });
  });

  it('still builds the upcoming occurrence for a ticket that is not old enough yet, so it can be test-run', () => {
    expect(DATE_TRIGGER_OCCURRENCE_RULES['ticket.status_age'].fromRecord({ status_changed_at: '2026-09-10T00:00:00Z' }, '2026-09-12', params))
      .toMatchObject({ occursOn: '2026-09-17', payload: { repeatIndex: 0, daysInStatus: 2 } });
    expect(DATE_TRIGGER_OCCURRENCE_RULES['ticket.status_age'].fromRecord({ status_changed_at: '2026-09-10T00:00:00Z' }, '2026-09-12', undefined)).toBeNull();
  });
});

describe('payload.TicketStatusAge.v1', () => {
  const ids = {
    ticketId: '11111111-1111-4111-8111-111111111111', statusId: '22222222-2222-4222-8222-222222222222', boardId: '33333333-3333-4333-8333-333333333333',
    contactId: '44444444-4444-4444-8444-444444444444', assignedUserId: '55555555-5555-4555-8555-555555555555',
  };
  const payload = {
    ...ids, ticketNumber: 'T-100', title: 'Printer', statusName: 'Waiting for client', boardName: 'Support',
    enteredStatusAt: '2026-09-01T09:00:00.000Z', daysInStatus: 7, repeatIndex: 0, occursOn: '2026-09-08', fireDate: '2026-09-08', offsetDays: 0,
  };
  const schema = dateTriggerPayloadSchemas['payload.TicketStatusAge.v1'];

  it('accepts a payload with contact and assignee, and the optional ids may be absent', () => {
    expect(schema.safeParse(payload).success).toBe(true);
    const { contactId: _c, assignedUserId: _a, ...unassigned } = payload;
    expect(schema.safeParse(unassigned).success).toBe(true);
  });

  it('rejects a payload missing required fields', () => {
    const { statusName: _s, ...incomplete } = payload;
    expect(schema.safeParse(incomplete).success).toBe(false);
  });
});

describe('an event trigger on a date source catalog row', () => {
  const eventDefinition = (eventName: string) => ({
    id: 'wf', version: 1, name: 'Catalog trap', payloadSchemaRef: 'payload.TicketStatusAge.v1', trigger: { type: 'event', eventName }, steps: [],
  }) as any;

  it('is rejected at publish, pointing at the date trigger', () => {
    const errors = validateWorkflowDefinition(eventDefinition('TICKET_STATUS_AGE')).errors;
    const found = errors.find((e) => e.code === 'EVENT_TRIGGER_IS_DATE_SOURCE');
    expect(found?.message).toContain('date trigger');
    expect(found?.message).toContain('ticket.status_age');
  });

  it('does not reject real events, including ones a date source also emits', () => {
    for (const name of ['TICKET_CREATED', 'CLIENT_ANNIVERSARY_UPCOMING']) {
      expect(validateWorkflowDefinition(eventDefinition(name)).errors.map((e) => e.code)).not.toContain('EVENT_TRIGGER_IS_DATE_SOURCE');
    }
  });
});

describe('publish validation of the status-age trigger', () => {
  const definition = (trigger: Record<string, unknown>) => ({
    id: 'wf', version: 1, name: 'Lynda: ticket waiting for client 7 days', payloadSchemaRef: 'payload.TicketStatusAge.v1', trigger, steps: [],
  }) as any;
  const codes = (trigger: Record<string, unknown>) => validateWorkflowDefinition(definition(trigger)).errors.map((e) => e.code);

  it('rejects missing or invalid params and a non-zero offset', () => {
    expect(codes({ type: 'date', source: 'ticket.status_age', offsetDays: 0 })).toContain('DATE_TRIGGER_PARAMS_INVALID');
    expect(codes({ type: 'date', source: 'ticket.status_age', offsetDays: 0, params: { statusName: 'x', days: 0 } })).toContain('DATE_TRIGGER_PARAMS_INVALID');
    expect(codes({ type: 'date', source: 'ticket.status_age', offsetDays: 2, params })).toContain('DATE_TRIGGER_OFFSET_NOT_SUPPORTED');
  });

  it('accepts valid params', () => {
    const found = codes({ type: 'date', source: 'ticket.status_age', offsetDays: 0, params });
    expect(found).not.toContain('DATE_TRIGGER_PARAMS_INVALID');
    expect(found).not.toContain('DATE_TRIGGER_OFFSET_NOT_SUPPORTED');
  });
});

/**
 * Lynda's workflow: "when a ticket has been in Waiting for client for 7 days, email the contact and
 * the assigned technician". The trigger fires once per ticket and hands both ids to the steps; there
 * is no Wait step and no ticket search.
 *
 * The contact leg is runnable today (contacts.find resolves payload.contactId to an address). The
 * assigned-user leg reads payload.assignedUserId and needs the "email the assigned user" action from
 * the sibling card, which this work does not build, so it is asserted only as a payload field.
 */
describe("Lynda's workflow: Waiting for client for 7 days", () => {
  const trigger = { type: 'date', source: 'ticket.status_age', offsetDays: 0, localTime: '08:00', params: { statusName: 'Waiting for client', days: 7 } };
  const lynda = {
    id: 'lynda-waiting-for-client', version: 1, name: 'Lynda: ticket waiting for client 7 days',
    payloadSchemaRef: 'payload.TicketStatusAge.v1', trigger,
    steps: [
      { id: 'find-contact', type: 'action.call', config: { actionId: 'contacts.find', version: 1, inputMapping: { contact_id: { $expr: 'payload.contactId' } }, saveAs: 'vars.contact' } },
      { id: 'email-contact', type: 'action.call', config: { actionId: 'email.send', version: 1, inputMapping: {
        to: [{ email: { $expr: 'vars.contact.contact.email' } }],
        subject: 'Still waiting to hear from you about ticket {{payload.ticketNumber}}',
        text: 'Ticket {{payload.ticketNumber}} has been waiting on you for {{payload.daysInStatus}} days.',
      } } },
    ],
  } as any;

  it('uses a trigger the date schema and publish rules accept, with no offset and no Wait step', () => {
    expect(workflowDateTriggerWithParamsSchema.safeParse(trigger).success).toBe(true);
    expect(lynda.steps.some((step: any) => step.type === 'time.wait')).toBe(false);
    const result = validateWorkflowDefinition(lynda);
    const codes = result.errors.map((e) => e.code);
    expect(codes).not.toContain('DATE_TRIGGER_PARAMS_INVALID');
    expect(codes).not.toContain('DATE_TRIGGER_OFFSET_NOT_SUPPORTED');
    expect(codes).not.toContain('INVALID_WORKFLOW_DEFINITION');
  });

  it('receives the contact and assignee ids the steps read', () => {
    const payload = {
      ticketId: '11111111-1111-4111-8111-111111111111', ticketNumber: 'T-100', title: 'Printer', statusId: '22222222-2222-4222-8222-222222222222',
      statusName: 'Waiting for client', boardId: '33333333-3333-4333-8333-333333333333', boardName: 'Support',
      clientId: '44444444-4444-4444-8444-444444444444', clientName: 'Acme',
      contactId: '55555555-5555-4555-8555-555555555555', assignedUserId: '66666666-6666-4666-8666-666666666666',
      enteredStatusAt: '2026-09-01T09:00:00.000Z', daysInStatus: 7, repeatIndex: 0, occursOn: '2026-09-08', fireDate: '2026-09-08', offsetDays: 0,
    };
    const parsed = dateTriggerPayloadSchemas['payload.TicketStatusAge.v1'].safeParse(payload);
    expect(parsed.success).toBe(true);
    expect(parsed.data).toMatchObject({ contactId: payload.contactId, assignedUserId: payload.assignedUserId });
  });
});
