import { describe, expect, it, vi } from 'vitest';

vi.mock('../WorkflowActionInputFixedPicker', () => ({
  WorkflowActionInputFixedPicker: () => null,
  WORKFLOW_FIXED_PICKER_SUPPORTED_RESOURCES: new Set(['ticket', 'contact', 'user']),
}));
vi.mock('@alga-psa/workflows/actions', () => ({}));
vi.mock('@alga-psa/user-composition/actions', () => ({ getCurrentUser: vi.fn() }));
vi.mock('@alga-psa/tickets/actions/ticketActions', () => ({ getTicketById: vi.fn() }));

import { buildInitialPayloadFromSchema } from '../WorkflowRunDialog';

describe('run dialog initial payload', () => {
  it('does not invent ids for required id fields', () => {
    const payload = buildInitialPayloadFromSchema({
      type: 'object',
      required: ['ticketId', 'messageId', 'externalId', 'body', 'occurredAt'],
      properties: {
        ticketId: { type: 'string', format: 'uuid', 'x-workflow-picker-kind': 'ticket' },
        messageId: { type: 'string', format: 'uuid' },
        externalId: { type: 'string' },
        body: { type: 'string' },
        occurredAt: { type: 'string', format: 'date-time' },
      },
    } as never);

    expect(payload).not.toHaveProperty('ticketId');
    expect(payload).not.toHaveProperty('messageId');
    expect(payload).not.toHaveProperty('externalId');
    expect(payload.body).toBe('body-sample');
    expect(typeof payload.occurredAt).toBe('string');
    expect(JSON.stringify(payload)).not.toContain('00000000');
  });
});
