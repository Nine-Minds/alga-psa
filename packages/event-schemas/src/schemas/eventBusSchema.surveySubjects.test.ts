import { describe, expect, it } from 'vitest';
import { EventSchemas } from './eventBusSchema';

const id = '00000000-0000-4000-8000-000000000001';
const base = { tenantId: id, responseId: id, rating: 1, hasComment: true };
function parse(eventType: 'SURVEY_RESPONSE_SUBMITTED' | 'SURVEY_NEGATIVE_RESPONSE', subject: Record<string, unknown>) {
  return EventSchemas[eventType].safeParse({
    id, timestamp: '2026-09-07T12:00:00.000Z', eventType,
    payload: { ...base, ...subject },
  });
}

describe.each(['SURVEY_RESPONSE_SUBMITTED', 'SURVEY_NEGATIVE_RESPONSE'] as const)('%s subject identity', eventType => {
  it.each(['ticket', 'project'])('preserves a %s subject without inventing the other identity', kind => {
    const subject = { [`${kind}Id`]: id, ...(eventType === 'SURVEY_NEGATIVE_RESPONSE' ? { [`${kind}Number`]: '123' } : {}) };
    const result = parse(eventType, subject);
    expect(result.success).toBe(true);
    if (!result.success) throw result.error;
    expect(result.data.payload).toMatchObject(subject);
    expect(result.data.payload).not.toHaveProperty(kind === 'ticket' ? 'projectId' : 'ticketId');
  });
  it('rejects missing subject identity', () => {
    expect(parse(eventType, {}).success).toBe(false);
  });
  it('rejects ambiguous subject identity', () => {
    expect(parse(eventType, { ticketId: id, projectId: id, ticketNumber: '123', projectNumber: '456' }).success).toBe(false);
  });
  it('rejects malformed project identity', () => {
    expect(parse(eventType, { projectId: 'not-a-uuid', projectNumber: '123' }).success).toBe(false);
  });
});

describe('negative survey subject numbering', () => {
  it.each(['ticket', 'project'])('requires the %s number and rejects a mismatched number', kind => {
    const other = kind === 'ticket' ? 'project' : 'ticket';
    expect(parse('SURVEY_NEGATIVE_RESPONSE', { [`${kind}Id`]: id }).success).toBe(false);
    expect(parse('SURVEY_NEGATIVE_RESPONSE', { [`${kind}Id`]: id, [`${other}Number`]: '123' }).success).toBe(false);
    expect(parse('SURVEY_NEGATIVE_RESPONSE', { [`${kind}Id`]: id, [`${kind}Number`]: '123', [`${other}Number`]: '456' }).success).toBe(false);
  });
});
