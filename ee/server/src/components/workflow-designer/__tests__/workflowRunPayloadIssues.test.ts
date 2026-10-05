import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { normalizeWorkflowPayloadZodIssues } from '@alga-psa/workflows/authoring';

import {
  describeRunPayloadValidationFailure,
  describeWorkflowPayloadIssue,
  labelRunPayloadPath,
  pruneEmptyOptionalRunPayloadFields,
  validateRunPayloadAgainstSchema,
  type RunPayloadJsonSchema,
} from '../workflowRunPayloadIssues';

const translate = (_key: string, options: Record<string, unknown>) =>
  String(options.defaultValue ?? '').replace(/\{\{(\w+)\}\}/g, (_match, name) => String(options[name] ?? ''));

// Shaped like TICKET_CUSTOMER_REPLIED.
const customerReplied = z.object({
  ticketId: z.string().uuid(),
  messageId: z.string().uuid().describe('Message ID'),
  contactId: z.string().uuid().optional(),
  channel: z.enum(['email', 'portal', 'ui', 'api']),
  receivedAt: z.string().datetime().optional(),
  attachmentsCount: z.number().int().nonnegative().optional(),
});
const jsonSchema = zodToJsonSchema(customerReplied) as RunPayloadJsonSchema;

describe('Run dialog payload issues', () => {
  it('finds the same problems in the form as the server does', () => {
    const payload = {
      ticketId: '3f2c1a5e-0b7d-4c1e-9a2f-6d8e4b1c7a90',
      messageId: 'reply-1',
      channel: 'fax',
      receivedAt: 'yesterday',
      attachmentsCount: -2,
    };
    const client = validateRunPayloadAgainstSchema(jsonSchema, payload);
    const server = normalizeWorkflowPayloadZodIssues((customerReplied.safeParse(payload) as any).error.issues);
    const sortByPath = (issues: Array<{ path: Array<string | number> }>) =>
      [...issues].sort((a, b) => a.path.join('.').localeCompare(b.path.join('.')));
    expect(sortByPath(client).map((issue) => [issue.path, (issue as any).kind]))
      .toEqual(sortByPath(server).map((issue) => [issue.path, (issue as any).kind]));
  });

  it('says in plain language what each field needs', () => {
    const [issue] = validateRunPayloadAgainstSchema(jsonSchema, {
      ticketId: '3f2c1a5e-0b7d-4c1e-9a2f-6d8e4b1c7a90',
      messageId: 'reply-1',
      channel: 'email',
    });
    expect(describeWorkflowPayloadIssue(translate, issue, 'Message')).toBe(
      'Message must be an id (UUID), like 3f2c1a5e-0b7d-4c1e-9a2f-6d8e4b1c7a90'
    );
    expect(describeWorkflowPayloadIssue(translate, { path: ['channel'], kind: 'choice', options: ['email', 'portal'] }, 'Channel'))
      .toBe('Channel must be one of: email, portal');
    expect(describeWorkflowPayloadIssue(translate, { path: ['ticketId'], kind: 'required' }, 'Ticket'))
      .toBe('Ticket is required');
  });

  it('leaves out optional fields left empty, but keeps empty required ones', () => {
    expect(pruneEmptyOptionalRunPayloadFields(jsonSchema, {
      ticketId: '',
      contactId: '',
      receivedAt: null,
      channel: 'email',
    })).toEqual({ ticketId: '', channel: 'email' });
    expect(validateRunPayloadAgainstSchema(jsonSchema, { ticketId: '', channel: 'email' })).toEqual(
      expect.arrayContaining([
        { path: ['ticketId'], kind: 'required' },
        { path: ['messageId'], kind: 'required' },
      ])
    );
  });

  it('names nested fields and list items', () => {
    expect(labelRunPayloadPath(
      ['ticket', 'comments', 1, 'note'],
      (key) => key.charAt(0).toUpperCase() + key.slice(1),
      (position) => `item ${position}`
    )).toBe('Ticket › Comments › item 2 › Note');
  });

  it('never reports a bare "payload failed validation": the summary names the fields', () => {
    const failure = describeRunPayloadValidationFailure(
      translate,
      { appliesTo: 'input', issues: [{ path: ['messageId'], kind: 'format', format: 'uuid' }] },
      () => 'Message',
      'run-1'
    );
    expect(failure.title).toBe('Fix these fields, then start the run again');
    expect(failure.description).toContain('Message must be an id (UUID)');
    expect(failure.description).not.toMatch(/failed validation/i);

    const mapped = describeRunPayloadValidationFailure(
      translate,
      { appliesTo: 'mappedPayload', issues: [{ path: ['ticketId'], kind: 'required' }] },
      () => 'Ticket',
      'run-1'
    );
    expect(mapped.title).toMatch(/trigger mapping/i);
    expect(mapped.description).toContain('Ticket is required');
  });
});
