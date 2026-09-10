import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { buildSurveySentPayload, buildSurveyReminderSentPayload, buildSurveyResponseReceivedPayload, buildSurveyExpiredPayload } from '../surveyEventBuilders';
import { surveySentEventPayloadSchema, surveyReminderSentEventPayloadSchema, surveyResponseReceivedEventPayloadSchema, surveyExpiredEventPayloadSchema } from '../../../runtime/schemas/communicationsEventSchemas';

const base = { tenantId: randomUUID(), occurredAt: new Date().toISOString() };
const common = { surveyId: randomUUID(), recipientId: randomUUID() };
const cases = [
  { name: 'sent', build: buildSurveySentPayload, schema: surveySentEventPayloadSchema, params: { ...common, surveyType: 'csat', channel: 'email' } },
  { name: 'reminder', build: buildSurveyReminderSentPayload, schema: surveyReminderSentEventPayloadSchema, params: { ...common, channel: 'email', reminderNumber: 2 } },
  { name: 'response', build: buildSurveyResponseReceivedPayload, schema: surveyResponseReceivedEventPayloadSchema, params: { ...common, responseId: randomUUID(), score: 5 } },
  { name: 'expired', build: buildSurveyExpiredPayload, schema: surveyExpiredEventPayloadSchema, params: common },
];

for (const { name, build, schema, params } of cases) describe(`survey ${name} subject`, () => {
  it('preserves project identity through payload construction and runtime validation', () => {
    const projectId = randomUUID();
    const parsed = schema.parse({ ...base, ...build({ ...params, projectId } as any) });
    expect(parsed).toMatchObject({ projectId });
    expect(parsed).not.toHaveProperty('ticketId');
  });
  it('retains existing ticket and subjectless event compatibility', () => {
    const ticketId = randomUUID();
    expect(schema.parse({ ...base, ...build({ ...params, ticketId } as any) })).toMatchObject({ ticketId });
    expect(schema.safeParse({ ...base, ...build(params as any) }).success).toBe(true);
  });
  it('rejects ambiguous subjects and invalid project identifiers', () => {
    const subjects = { ticketId: randomUUID(), projectId: randomUUID() };
    expect(() => build({ ...params, ...subjects } as any)).toThrow('one survey subject');
    expect(schema.safeParse({ ...base, ...params, ...subjects }).success).toBe(false);
    expect(schema.safeParse({ ...base, ...params, projectId: 'not-a-project-id' }).success).toBe(false);
  });
});
