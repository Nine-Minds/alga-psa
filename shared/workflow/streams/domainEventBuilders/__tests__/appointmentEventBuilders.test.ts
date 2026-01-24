import { describe, expect, it } from 'vitest';
import { buildWorkflowPayload } from '../../workflowEventPublishHelpers';
import {
  appointmentAssignedEventPayloadSchema,
  appointmentCanceledEventPayloadSchema,
  appointmentCompletedEventPayloadSchema,
  appointmentCreatedEventPayloadSchema,
  appointmentNoShowEventPayloadSchema,
  appointmentRescheduledEventPayloadSchema,
} from '../../../runtime/schemas/schedulingEventSchemas';
import {
  buildAppointmentAssignedPayload,
  buildAppointmentCanceledPayload,
  buildAppointmentCompletedPayload,
  buildAppointmentCreatedPayload,
  buildAppointmentNoShowPayload,
  buildAppointmentRescheduledPayload,
} from '../appointmentEventBuilders';

describe('appointmentEventBuilders', () => {
  const tenantId = '7e8a6f60-7a47-4f20-b2ac-5b77a3b5c9fd';
  const actorUserId = 'a836a8b5-3df5-47b1-b49b-9a78f2b1a8a0';
  const appointmentId = '14f1fbf4-17d6-4bdc-8d4b-0b2a2ff8f26a';
  const ticketId = '4f6d2d0b-2500-4a0d-8c27-51a3b18c6a72';
  const occurredAt = '2026-01-23T12:00:00.000Z';

  const ctx = {
    tenantId,
    occurredAt,
    actor: { actorType: 'USER' as const, actorUserId },
  };

  it('builds APPOINTMENT_CREATED payloads compatible with schema', () => {
    const payload = buildWorkflowPayload(
      buildAppointmentCreatedPayload({
        entry: {
          entry_id: appointmentId,
          work_item_type: 'appointment_request',
          scheduled_start: '2026-01-24T10:00:00.000Z',
          scheduled_end: '2026-01-24T11:00:00.000Z',
          assigned_user_ids: [actorUserId],
          created_at: '2026-01-23T11:59:00.000Z',
        },
        ticketId,
        timezone: 'UTC',
      }),
      ctx
    );

    expect(appointmentCreatedEventPayloadSchema.safeParse(payload).success).toBe(true);
  });

  it('builds APPOINTMENT_RESCHEDULED payloads compatible with schema', () => {
    const payload = buildWorkflowPayload(
      buildAppointmentRescheduledPayload({
        before: {
          entry_id: appointmentId,
          scheduled_start: '2026-01-24T10:00:00.000Z',
          scheduled_end: '2026-01-24T11:00:00.000Z',
        },
        after: {
          entry_id: appointmentId,
          scheduled_start: '2026-01-24T12:00:00.000Z',
          scheduled_end: '2026-01-24T13:00:00.000Z',
        },
        ticketId,
        timezone: 'UTC',
      }),
      ctx
    );

    expect(appointmentRescheduledEventPayloadSchema.safeParse(payload).success).toBe(true);
  });

  it('builds APPOINTMENT_ASSIGNED payloads compatible with schema', () => {
    const payload = buildWorkflowPayload(
      buildAppointmentAssignedPayload({
        appointmentId,
        ticketId,
        previousAssigneeId: '6c0a6e9b-6a4b-4f0a-a5fd-30f8b2c2da6b',
        newAssigneeId: actorUserId,
      }),
      ctx
    );

    expect(appointmentAssignedEventPayloadSchema.safeParse(payload).success).toBe(true);
  });

  it('builds APPOINTMENT_CANCELED payloads compatible with schema', () => {
    const payload = buildWorkflowPayload(
      buildAppointmentCanceledPayload({
        appointmentId,
        ticketId,
        reason: 'Cancelled by client',
      }),
      ctx
    );

    expect(appointmentCanceledEventPayloadSchema.safeParse(payload).success).toBe(true);
  });

  it('builds APPOINTMENT_COMPLETED payloads compatible with schema', () => {
    const payload = buildWorkflowPayload(
      buildAppointmentCompletedPayload({
        appointmentId,
        ticketId,
        outcome: 'done',
      }),
      ctx
    );

    expect(appointmentCompletedEventPayloadSchema.safeParse(payload).success).toBe(true);
  });

  it('builds APPOINTMENT_NO_SHOW payloads compatible with schema', () => {
    const payload = buildWorkflowPayload(
      buildAppointmentNoShowPayload({
        appointmentId,
        ticketId,
        party: 'customer',
      }),
      ctx
    );

    expect(appointmentNoShowEventPayloadSchema.safeParse(payload).success).toBe(true);
  });
});
