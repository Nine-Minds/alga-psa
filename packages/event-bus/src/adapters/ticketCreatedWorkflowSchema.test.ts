/**
 * alga-2026-0002379 — every ticket-creation publisher must hand the event bus a
 * TICKET_CREATED whose workflow-stream form validates against the
 * `payload.TicketCreated.v1` schema the workflow worker enforces. Uses the real
 * ServerEventPublisher (client portal) and real publishWorkflowEvent; only the
 * Redis-backed bus is replaced with a capture.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ publish: vi.fn(), registerAfterCommit: vi.fn() }));

vi.mock('../index', () => ({ getEventBus: () => ({ publish: mocks.publish }) }));
vi.mock('@alga-psa/db', () => ({ registerAfterCommit: mocks.registerAfterCommit }));

import { convertToWorkflowEvent } from '../schemas/eventBusSchema';
import { workflowEventPayloadSchemas } from '../../../event-schemas/src/schemas/domain/workflowEventPayloadSchemas';
import { ServerEventPublisher } from './serverEventPublisher';

const TENANT = '91a53464-0b67-4e3f-ae88-922d9c5af6ed';
const TICKET = '7fa265ac-3a50-4ad6-9454-4a860d884996';
const USER = '3b0f4a6e-1f33-4f0c-8f0d-0d0d0d0d0d0d';

function workflowStreamPayload(event: any) {
  return convertToWorkflowEvent({ ...event, id: 'c9f1f8d4-7c1f-4a0c-9b0e-5a2f1f7f3a11', timestamp: new Date().toISOString() }).payload;
}

describe('client-portal ticket creation publishes a workflow-valid TICKET_CREATED', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.publish.mockResolvedValue(undefined);
  });

  it('publishes TICKET_CREATED to the global workflow stream with a payload the worker accepts', async () => {
    await new ServerEventPublisher().publishTicketCreated({
      tenantId: TENANT,
      ticketId: TICKET,
      userId: USER,
      metadata: { source: 'client_portal' },
    });

    const globalCall = mocks.publish.mock.calls.find(([, opts]) => !opts?.channel);
    expect(globalCall).toBeDefined();
    const event = globalCall![0];
    expect(event.eventType).toBe('TICKET_CREATED');

    const parsed = workflowEventPayloadSchemas['payload.TicketCreated.v1'].safeParse(workflowStreamPayload(event));
    expect(parsed.error?.issues ?? []).toEqual([]);
    expect(parsed.success).toBe(true);
  });
});
