import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { describeManualRunPayloadFailure, normalizeWorkflowPayloadZodIssues } from '../payloadIssues';

const issuesFor = (schema: z.ZodTypeAny, value: unknown) => {
  const result = schema.safeParse(value);
  if (result.success) throw new Error('expected a validation failure');
  return normalizeWorkflowPayloadZodIssues(result.error.issues);
};

describe('workflow payload issues', () => {
  const payload = z.object({
    ticketId: z.string().uuid(),
    messageId: z.string().uuid(),
    channel: z.enum(['email', 'portal']),
    receivedAt: z.string().datetime().optional(),
    note: z.string().min(1),
    attachmentsCount: z.number().int().nonnegative().optional(),
    contact: z.object({ email: z.string().email() }).optional(),
  }).strict();

  it('names each field and what is wrong with it', () => {
    expect(issuesFor(payload, {
      ticketId: '3f2c1a5e-1111-4222-8333-444455556666',
      messageId: 'abc',
      channel: 'fax',
      receivedAt: 'yesterday',
      note: '',
      attachmentsCount: -1,
      contact: { email: 'nope' },
      extra: true,
    })).toEqual(expect.arrayContaining([
      { path: ['messageId'], kind: 'format', format: 'uuid' },
      { path: ['channel'], kind: 'choice', options: ['email', 'portal'] },
      { path: ['receivedAt'], kind: 'format', format: 'date-time' },
      { path: ['note'], kind: 'required' },
      { path: ['attachmentsCount'], kind: 'too_small', limit: 0, sizeOf: 'number' },
      { path: ['contact', 'email'], kind: 'format', format: 'email' },
      { path: ['extra'], kind: 'unknown_field' },
    ]));
  });

  it('reports missing and wrongly typed fields', () => {
    expect(issuesFor(payload, { ticketId: 42 })).toEqual(expect.arrayContaining([
      { path: ['ticketId'], kind: 'type', expected: 'string' },
      { path: ['messageId'], kind: 'required' },
    ]));
  });

  it('reports the closest alternative of a union', () => {
    const schema = z.object({ when: z.union([z.string().datetime(), z.number()]) });
    expect(issuesFor(schema, { when: 'soon' })).toEqual([{ path: ['when'], kind: 'format', format: 'date-time' }]);
  });
});

describe('manual run payload failures', () => {
  const workflowPayload = z.object({ ticketId: z.string().uuid(), summary: z.string() });
  const eventPayload = z.object({ ticketId: z.string().uuid(), messageId: z.string().uuid() });

  it('points at the dialog fields when the payload went straight to the workflow', () => {
    const mapped = workflowPayload.safeParse({ ticketId: 'x' });
    expect(describeManualRunPayloadFailure({
      mappedIssues: (mapped as any).error.issues,
      submittedPayload: { ticketId: 'x' },
      submittedIsMapped: false,
      sourceSchema: null,
    }).appliesTo).toBe('input');
  });

  it('finds the event fields to fix when a trigger mapping fed the workflow', () => {
    const submitted = { ticketId: '3f2c1a5e-0b7d-4c1e-9a2f-6d8e4b1c7a90', messageId: 'reply-1' };
    const mapped = workflowPayload.safeParse({ ticketId: submitted.ticketId });
    const failure = describeManualRunPayloadFailure({
      mappedIssues: (mapped as any).error.issues,
      submittedPayload: submitted,
      submittedIsMapped: true,
      sourceSchema: eventPayload,
    });
    expect(failure).toEqual({ appliesTo: 'input', issues: [{ path: ['messageId'], kind: 'format', format: 'uuid' }] });
  });

  it('reports the mapped payload when the event payload itself is fine', () => {
    const submitted = { ticketId: '3f2c1a5e-0b7d-4c1e-9a2f-6d8e4b1c7a90', messageId: '3f2c1a5e-0b7d-4c1e-9a2f-6d8e4b1c7a91' };
    const mapped = workflowPayload.safeParse({ ticketId: submitted.ticketId });
    expect(describeManualRunPayloadFailure({
      mappedIssues: (mapped as any).error.issues,
      submittedPayload: submitted,
      submittedIsMapped: true,
      sourceSchema: eventPayload,
    })).toEqual({ appliesTo: 'mappedPayload', issues: [{ path: ['summary'], kind: 'required' }] });
  });
});
