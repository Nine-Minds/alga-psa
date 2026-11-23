/**
 * T223–T225 — F129 of `ee/plans/2026-11-21-itil-remediation` (`sla`).
 *
 * The resolution stage events describe the ticket's own SLA: the policy that applies to it, the
 * moment its clock started and the moment resolution is due. They used to be computed from a
 * hard-coded table of hours keyed on `tickets.itil_priority_level`, a column no create ever wrote.
 */
import { describe, expect, it } from 'vitest';
import { buildWorkflowPayload } from '@alga-psa/event-schemas';
import {
  ticketSlaStageBreachedEventPayloadSchema,
  ticketSlaStageEnteredEventPayloadSchema,
  ticketSlaStageMetEventPayloadSchema,
} from '@alga-psa/event-schemas';
import {
  buildTicketResolutionSlaStageCompletionEvent,
  buildTicketResolutionSlaStageEnteredEvent,
} from '../ticketSlaStageEvents';

const TENANT_ID = '00000000-0000-0000-0000-000000000000';
const TICKET_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const POLICY_ID = '33333333-3333-3333-3333-333333333333';

describe('ticketSlaStageEvents', () => {
  it('T223: emits resolution stage entered with the ticket’s own policy and due time', () => {
    const startedAt = '2026-01-23T12:00:00.000Z';
    const dueAt = '2026-01-23T16:00:00.000Z';
    const entered = buildTicketResolutionSlaStageEnteredEvent({
      tenantId: TENANT_ID,
      ticketId: TICKET_ID,
      slaPolicyId: POLICY_ID,
      slaStartedAt: startedAt,
      slaResolutionDueAt: dueAt,
    });

    expect(entered?.eventType).toBe('TICKET_SLA_STAGE_ENTERED');
    expect(entered?.payload).toMatchObject({
      ticketId: TICKET_ID,
      slaPolicyId: POLICY_ID,
      stage: 'resolution',
      enteredAt: startedAt,
      targetAt: dueAt,
    });

    const ctx = {
      tenantId: TENANT_ID,
      occurredAt: startedAt,
      actor: { actorType: 'USER' as const, actorUserId: USER_ID },
    };
    ticketSlaStageEnteredEventPayloadSchema.parse(buildWorkflowPayload(entered!.payload as any, ctx));
  });

  it('T223: falls back to the ticket’s entered_at when the SLA start is not recorded', () => {
    const enteredAt = '2026-01-23T12:00:00.000Z';
    const entered = buildTicketResolutionSlaStageEnteredEvent({
      tenantId: TENANT_ID,
      ticketId: TICKET_ID,
      slaPolicyId: POLICY_ID,
      slaResolutionDueAt: '2026-01-23T16:00:00.000Z',
      enteredAt,
    });

    expect(entered?.payload).toMatchObject({ enteredAt, slaPolicyId: POLICY_ID });
  });

  it('T224: emits resolution stage met when closed before the ticket’s due time', () => {
    const startedAt = '2026-01-23T12:00:00.000Z';
    const dueAt = '2026-01-23T16:00:00.000Z';
    const closedAt = '2026-01-23T15:59:00.000Z';
    const met = buildTicketResolutionSlaStageCompletionEvent({
      tenantId: TENANT_ID,
      ticketId: TICKET_ID,
      slaPolicyId: POLICY_ID,
      slaStartedAt: startedAt,
      slaResolutionDueAt: dueAt,
      closedAt,
    });

    expect(met?.eventType).toBe('TICKET_SLA_STAGE_MET');
    expect(met?.payload).toMatchObject({
      ticketId: TICKET_ID,
      slaPolicyId: POLICY_ID,
      stage: 'resolution',
      metAt: closedAt,
      targetAt: dueAt,
    });

    const ctx = {
      tenantId: TENANT_ID,
      occurredAt: closedAt,
      actor: { actorType: 'USER' as const, actorUserId: USER_ID },
    };
    ticketSlaStageMetEventPayloadSchema.parse(buildWorkflowPayload(met!.payload as any, ctx));
  });

  it('T224: emits resolution stage breached with overdueBySeconds when closed after the due time', () => {
    const startedAt = '2026-01-23T12:00:00.000Z';
    const dueAt = '2026-01-23T16:00:00.000Z';
    const closedAt = '2026-01-23T17:00:05.000Z';
    const breached = buildTicketResolutionSlaStageCompletionEvent({
      tenantId: TENANT_ID,
      ticketId: TICKET_ID,
      slaPolicyId: POLICY_ID,
      slaStartedAt: startedAt,
      slaResolutionDueAt: dueAt,
      closedAt,
    });

    expect(breached?.eventType).toBe('TICKET_SLA_STAGE_BREACHED');
    expect(breached?.payload).toMatchObject({
      ticketId: TICKET_ID,
      slaPolicyId: POLICY_ID,
      stage: 'resolution',
      breachedAt: closedAt,
      targetAt: dueAt,
      overdueBySeconds: 3605,
    });

    const ctx = {
      tenantId: TENANT_ID,
      occurredAt: closedAt,
      actor: { actorType: 'USER' as const, actorUserId: USER_ID },
    };
    ticketSlaStageBreachedEventPayloadSchema.parse(buildWorkflowPayload(breached!.payload as any, ctx));
  });

  it('T225: a ticket without an SLA emits no stage event', () => {
    const startedAt = '2026-01-23T12:00:00.000Z';
    const closedAt = '2026-01-23T15:00:00.000Z';

    // No policy: the ticket runs on no SLA at all.
    expect(
      buildTicketResolutionSlaStageEnteredEvent({
        tenantId: TENANT_ID,
        ticketId: TICKET_ID,
        slaResolutionDueAt: '2026-01-23T16:00:00.000Z',
        enteredAt: startedAt,
      })
    ).toBeNull();
    expect(
      buildTicketResolutionSlaStageCompletionEvent({
        tenantId: TENANT_ID,
        ticketId: TICKET_ID,
        slaResolutionDueAt: '2026-01-23T16:00:00.000Z',
        enteredAt: startedAt,
        closedAt,
      })
    ).toBeNull();

    // A policy with no target for this ticket's priority: no resolution is due, so no stage.
    expect(
      buildTicketResolutionSlaStageEnteredEvent({
        tenantId: TENANT_ID,
        ticketId: TICKET_ID,
        slaPolicyId: POLICY_ID,
        slaStartedAt: startedAt,
      })
    ).toBeNull();
    expect(
      buildTicketResolutionSlaStageCompletionEvent({
        tenantId: TENANT_ID,
        ticketId: TICKET_ID,
        slaPolicyId: POLICY_ID,
        slaStartedAt: startedAt,
        closedAt,
      })
    ).toBeNull();
  });
});
