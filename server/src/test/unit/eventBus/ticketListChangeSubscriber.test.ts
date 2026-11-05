import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ publishTicketListActivity: vi.fn() }));
const { publishTicketListActivity } = mocks;
vi.mock('@alga-psa/tickets/lib/liveUpdates', () => ({ publishTicketListActivity: mocks.publishTicketListActivity }));
vi.mock('../../../lib/eventBus/index', () => ({ getEventBus: vi.fn() }));

import { handleTicketListChange } from '../../../lib/eventBus/subscribers/ticketListChangeSubscriber';

describe('ticket list activity event delivery', () => {
  beforeEach(() => publishTicketListActivity.mockClear());

  it.each([
    ['TICKET_CREATED', 'created', []],
    ['TICKET_UPDATED', 'updated', ['priority_id']],
    ['TICKET_COMMENT_ADDED', 'updated', ['comments']],
    ['INBOUND_EMAIL_REPLY_RECEIVED', 'updated', ['email']],
  ])('publishes a compact %s change for recipient-side enrichment', async (eventType, changeKind, fields) => {
    await handleTicketListChange({
      eventType,
      timestamp: '2026-11-02T12:00:00Z',
      payload: { tenantId: 'tenant-a', ticketId: 'ticket-a', boardId: 'board-a', userId: 'actor-a', changes: eventType === 'TICKET_UPDATED' ? { priority_id: 'p2' } : undefined },
    });
    expect(publishTicketListActivity).toHaveBeenCalledWith({
      tenantId: 'tenant-a', ticketId: 'ticket-a', changeKind, boardId: 'board-a', changedFields: fields,
      actorUserId: 'actor-a', updatedAt: '2026-11-02T12:00:00Z',
    });
  });

  it('does not publish events without tenant and ticket identity', async () => {
    await handleTicketListChange({ eventType: 'TICKET_UPDATED', payload: { tenantId: 'tenant-a' } });
    expect(publishTicketListActivity).not.toHaveBeenCalled();
  });

  it('uses the assigning actor rather than the assigned recipient for assignment activity', async () => {
    await handleTicketListChange({
      eventType: 'TICKET_ASSIGNED', timestamp: '2026-11-02T12:00:00Z',
      payload: { tenantId: 'tenant-a', ticketId: 'ticket-a', userId: 'assignee', assignedByUserId: 'actor-a' },
    });
    expect(publishTicketListActivity).toHaveBeenCalledWith(expect.objectContaining({
      actorUserId: 'actor-a', changedFields: ['assigned_to', 'assigned_team_id'],
    }));
  });
});
