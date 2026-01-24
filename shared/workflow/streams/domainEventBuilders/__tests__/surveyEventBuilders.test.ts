import { describe, expect, it } from 'vitest';
import { buildWorkflowPayload } from '@shared/workflow/streams/workflowEventPublishHelpers';
import {
  csatAlertTriggeredEventPayloadSchema,
  surveyExpiredEventPayloadSchema,
  surveyReminderSentEventPayloadSchema,
  surveyResponseReceivedEventPayloadSchema,
  surveySentEventPayloadSchema,
} from '@shared/workflow/runtime/schemas/communicationsEventSchemas';
import {
  buildCsatAlertTriggeredPayload,
  buildSurveyExpiredPayload,
  buildSurveyReminderSentPayload,
  buildSurveyResponseReceivedPayload,
  buildSurveySentPayload,
} from '../surveyEventBuilders';

describe('surveyEventBuilders', () => {
  it('builds a schema-valid SURVEY_SENT payload when enriched', () => {
    const base = buildSurveySentPayload({
      surveyId: 'd0ba9eb0-97d8-4d54-bd7d-d4d1a65b0c9f',
      surveyType: 'csat',
      recipientId: '6d4db6da-1465-4a42-9a08-7c0d2ad7cdad',
      ticketId: '3a556c52-6028-44f6-9c16-0e9e68d1f3d2',
      sentAt: '2026-01-24T01:02:03.000Z',
      channel: 'email',
      templateId: 'b9b7abf5-4b9b-4d14-a2e2-3d62c9b1a915',
    });

    const payload = buildWorkflowPayload(base, {
      tenantId: 'f4d15c5d-5594-4c12-9a23-8dba97e07924',
      occurredAt: '2026-01-24T01:02:03.000Z',
    });

    expect(surveySentEventPayloadSchema.parse(payload)).toEqual(payload);
  });

  it('builds a schema-valid SURVEY_RESPONSE_RECEIVED payload when enriched', () => {
    const base = buildSurveyResponseReceivedPayload({
      surveyId: 'd0ba9eb0-97d8-4d54-bd7d-d4d1a65b0c9f',
      responseId: '7b1d20cb-f26e-4ab7-94b4-4ec89e180cde',
      recipientId: '6d4db6da-1465-4a42-9a08-7c0d2ad7cdad',
      ticketId: '3a556c52-6028-44f6-9c16-0e9e68d1f3d2',
      respondedAt: '2026-01-24T01:04:03.000Z',
      score: 2,
      comment: 'Not great.',
    });

    const payload = buildWorkflowPayload(base, {
      tenantId: 'f4d15c5d-5594-4c12-9a23-8dba97e07924',
      occurredAt: '2026-01-24T01:04:03.000Z',
      actor: { actorType: 'CONTACT', actorContactId: '6d4db6da-1465-4a42-9a08-7c0d2ad7cdad' },
    });

    expect(surveyResponseReceivedEventPayloadSchema.parse(payload)).toEqual(payload);
  });

  it('builds a schema-valid SURVEY_REMINDER_SENT payload when enriched', () => {
    const base = buildSurveyReminderSentPayload({
      surveyId: 'd0ba9eb0-97d8-4d54-bd7d-d4d1a65b0c9f',
      recipientId: '6d4db6da-1465-4a42-9a08-7c0d2ad7cdad',
      ticketId: '3a556c52-6028-44f6-9c16-0e9e68d1f3d2',
      sentAt: '2026-01-24T01:05:03.000Z',
      channel: 'email',
      reminderNumber: 2,
    });

    const payload = buildWorkflowPayload(base, {
      tenantId: 'f4d15c5d-5594-4c12-9a23-8dba97e07924',
      occurredAt: '2026-01-24T01:05:03.000Z',
    });

    expect(surveyReminderSentEventPayloadSchema.parse(payload)).toEqual(payload);
  });

  it('builds a schema-valid SURVEY_EXPIRED payload when enriched', () => {
    const base = buildSurveyExpiredPayload({
      surveyId: 'd0ba9eb0-97d8-4d54-bd7d-d4d1a65b0c9f',
      recipientId: '6d4db6da-1465-4a42-9a08-7c0d2ad7cdad',
      ticketId: '3a556c52-6028-44f6-9c16-0e9e68d1f3d2',
      expiredAt: '2026-01-24T01:06:03.000Z',
    });

    const payload = buildWorkflowPayload(base, {
      tenantId: 'f4d15c5d-5594-4c12-9a23-8dba97e07924',
      occurredAt: '2026-01-24T01:06:03.000Z',
    });

    expect(surveyExpiredEventPayloadSchema.parse(payload)).toEqual(payload);
  });

  it('builds a schema-valid CSAT_ALERT_TRIGGERED payload when enriched', () => {
    const base = buildCsatAlertTriggeredPayload({
      window: 'daily',
      score: 1,
      threshold: 2,
      triggeredAt: '2026-01-24T01:04:03.000Z',
      scopeType: 'agent',
      scopeId: '57aa5f7d-ae68-40fc-acde-06f6e9e6b8cc',
    });

    const payload = buildWorkflowPayload(base, {
      tenantId: 'f4d15c5d-5594-4c12-9a23-8dba97e07924',
      occurredAt: '2026-01-24T01:04:03.000Z',
    });

    expect(csatAlertTriggeredEventPayloadSchema.parse(payload)).toEqual(payload);
  });

  it('throws when required fields are missing', () => {
    expect(() =>
      buildSurveySentPayload({
        // @ts-expect-error intentional
        surveyId: '',
        surveyType: 'csat',
        recipientId: 'x',
        channel: 'email',
      })
    ).toThrow(/surveyId/);

    expect(() =>
      buildSurveyReminderSentPayload({
        surveyId: 'd0ba9eb0-97d8-4d54-bd7d-d4d1a65b0c9f',
        recipientId: 'x',
        channel: 'email',
        reminderNumber: 0,
      })
    ).toThrow(/reminderNumber/);
  });
});

