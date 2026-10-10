import { beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';

const publishEvent = vi.hoisted(() => vi.fn());
const store = vi.hoisted(() => ({
  claimOutboxRow: vi.fn(),
  transitionOutboxRow: vi.fn(),
  getOutboxRow: vi.fn(),
  reclaimOutboxRow: vi.fn(),
}));

vi.mock('@alga-psa/db/admin', () => ({ getAdminConnection: async () => ({}) }));
vi.mock('@alga-psa/event-bus/publishers', () => ({ publishEvent }));
vi.mock('../inboundEmailDurableStore', () => ({
  ...store,
  getDurableLeaseTtlMs: () => 1000,
  getDurableMaxAttempts: () => 5,
}));

import { processInboundOutboxJob } from '../inboundEmailOutboxDispatcher';

const tenant = randomUUID();
const ticketId = randomUUID();

function rowWith(payload: Record<string, unknown>) {
  return {
    tenant, outbox_id: randomUUID(), event_type: 'TICKET_COMMENT_ADDED', payload,
    publish_options: null, lease_token: 't', lease_version: 1, attempts: 0,
  };
}

async function run(payload: Record<string, unknown>) {
  const row = rowWith(payload);
  store.claimOutboxRow.mockResolvedValue({ claimed: true, row });
  store.transitionOutboxRow.mockResolvedValue(true);
  const result = await processInboundOutboxJob({ jobId: 'j', tenantId: tenant, recordId: row.outbox_id } as any, {} as any);
  return { result, published: publishEvent.mock.calls[0][0] as { eventType: string; payload: any } };
}

describe('inboundEmailOutboxDispatcher legacy actor scrub', () => {
  beforeEach(() => { vi.clearAllMocks(); publishEvent.mockResolvedValue(undefined); });

  it('drops userId/actorUserId equal to the ticket id and downgrades to SYSTEM', async () => {
    const { published } = await run({ tenantId: tenant, ticketId, userId: ticketId, actorUserId: ticketId, actorType: 'USER' });
    expect(published.payload).not.toHaveProperty('userId');
    expect(published.payload).not.toHaveProperty('actorUserId');
    expect(published.payload.actorType).toBe('SYSTEM');
  });

  it('passes a real user through unchanged', async () => {
    const userId = randomUUID();
    const payload = { tenantId: tenant, ticketId, userId, actorUserId: userId, actorType: 'USER' };
    const { published } = await run(payload);
    expect(published.payload).toEqual(payload);
  });
});
