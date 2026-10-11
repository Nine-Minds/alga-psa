/**
 * alga-2026-0002379 — a published workflow with a TICKET_CREATED trigger never ran
 * for tickets created from inbound email.
 *
 * The workflow event-stream worker validates the payload it reads from
 * `workflow:events:global` against the `payload.TicketCreated.v1` schema, which
 * requires `occurredAt`. The UI / API / client-portal publishers go through
 * `publishWorkflowEvent` (which stamps `occurredAt`), but the inbound-email
 * publishers hand a raw payload to `publishEvent`. These tests follow the
 * payload each inbound publisher produces through the same conversion the event
 * bus applies before writing the workflow stream, then run the worker's
 * validation against it.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { convertToWorkflowEvent } from '@alga-psa/event-schemas';
import { workflowEventPayloadSchemas } from '../../../../packages/event-schemas/src/schemas/domain/workflowEventPayloadSchemas';

const TENANT = '91a53464-0b67-4e3f-ae88-922d9c5af6ed';
const TICKET = '7fa265ac-3a50-4ad6-9454-4a860d884996';

const publishEventMock = vi.fn();
const registerAfterCommitMock = vi.fn();
const insertOutboxRowMock = vi.fn();

vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishEvent: (...args: any[]) => publishEventMock(...args),
}));

vi.mock('@alga-psa/db', () => ({
  registerAfterCommit: (...args: any[]) => registerAfterCommitMock(...args),
}));

vi.mock('../../../services/email/inboundEmailDurableStore', () => ({
  insertOutboxRow: (...args: any[]) => insertOutboxRowMock(...args),
}));

/** What EventBus.publish() writes to the workflow stream, then what the worker validates. */
function validateAsWorkflowWorkerWould(event: { eventType: string; payload: Record<string, unknown> }) {
  const workflowEvent = convertToWorkflowEvent({
    ...event,
    id: 'c9f1f8d4-7c1f-4a0c-9b0e-5a2f1f7f3a11',
    timestamp: new Date().toISOString(),
  } as any);
  const schema = workflowEventPayloadSchemas['payload.TicketCreated.v1'];
  return schema.safeParse(workflowEvent.payload);
}

describe('inbound-email TICKET_CREATED reaches workflow triggers (alga-2026-0002379)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    publishEventMock.mockResolvedValue(undefined);
    insertOutboxRowMock.mockResolvedValue(undefined);
  });

  it('durable outbox publisher: replayed payload passes payload.TicketCreated.v1', async () => {
    const { InboundEmailOutboxEventPublisher } = await import('../inboundEmailOutboxEventPublisher');
    const publisher = new InboundEmailOutboxEventPublisher({ trx: {} as any, tenantId: TENANT, inboxId: 'inbox-1' });

    await publisher.publishTicketCreated({
      tenantId: TENANT,
      ticketId: TICKET,
      metadata: { source: 'email', board_id: 'd7853ff0-f826-43a4-a032-f5056b2c0202' },
    });

    const row = insertOutboxRowMock.mock.calls[0][1];
    expect(row.event_type).toBe('TICKET_CREATED');

    // The dispatcher replays row.payload verbatim through publishEvent.
    const result = validateAsWorkflowWorkerWould({ eventType: row.event_type, payload: row.payload });
    expect(result.error?.issues ?? []).toEqual([]);
    expect(result.success).toBe(true);
  });

  it('durable outbox publisher: occurredAt is stamped at enqueue so retries keep the original time', async () => {
    const { InboundEmailOutboxEventPublisher } = await import('../inboundEmailOutboxEventPublisher');
    const publisher = new InboundEmailOutboxEventPublisher({ trx: {} as any, tenantId: TENANT, inboxId: 'inbox-1' });

    await publisher.publishTicketCreated({ tenantId: TENANT, ticketId: TICKET });

    const payload = insertOutboxRowMock.mock.calls[0][1].payload;
    expect(typeof payload.occurredAt).toBe('string');
    expect(Number.isNaN(Date.parse(payload.occurredAt))).toBe(false);
  });

  it('non-durable WorkflowEventPublisher: payload passes payload.TicketCreated.v1', async () => {
    const { WorkflowEventPublisher } = await import('../workflowEventPublisher');
    await new WorkflowEventPublisher().publishTicketCreated({
      tenantId: TENANT,
      ticketId: TICKET,
      metadata: { source: 'email' },
    });

    const [event] = publishEventMock.mock.calls[0];
    const result = validateAsWorkflowWorkerWould(event);
    expect(result.error?.issues ?? []).toEqual([]);
    expect(result.success).toBe(true);
  });
});
