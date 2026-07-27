// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FakeTables } from './fakeTenantTables';

let tables: FakeTables = {};
const publishEventMock = vi.fn();

vi.mock('@alga-psa/db', async () => {
  const { createTenantDbMock } = await import('./fakeTenantTables');
  return { tenantDb: createTenantDbMock(() => tables) };
});

vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishEvent: (...args: any[]) => publishEventMock(...args),
}));

const TENANT = 'tenant-1';
const TICKET = 'ticket-1';
const ACTOR = 'user-actor';

const trx = {} as any;

describe('ticketResourceCore', () => {
  beforeEach(() => {
    publishEventMock.mockReset();
    tables = {
      tickets: [{ tenant: TENANT, ticket_id: TICKET, assigned_to: 'user-a' }],
      ticket_resources: [],
    };
  });

  describe('addTicketResourceCore', () => {
    it('adds an additional agent keyed to the current primary assignee', async () => {
      const { addTicketResourceCore } = await import('../ticketResourceCore');

      const resource = await addTicketResourceCore(trx, TENANT, ACTOR, TICKET, 'user-b', 'support');

      expect(resource).toMatchObject({
        ticket_id: TICKET,
        assigned_to: 'user-a',
        additional_user_id: 'user-b',
        role: 'support',
      });
      expect(publishEventMock).toHaveBeenCalledWith({
        eventType: 'TICKET_ADDITIONAL_AGENT_ASSIGNED',
        payload: {
          tenantId: TENANT,
          ticketId: TICKET,
          primaryAgentId: 'user-a',
          additionalAgentId: 'user-b',
          assignedByUserId: ACTOR,
        },
      });
    });

    it('promotes the user to primary when the ticket is unassigned', async () => {
      tables.tickets[0].assigned_to = null;
      const { addTicketResourceCore } = await import('../ticketResourceCore');

      const resource = await addTicketResourceCore(trx, TENANT, ACTOR, TICKET, 'user-b', 'support');

      expect(resource).toBeNull();
      expect(tables.tickets[0]).toMatchObject({ assigned_to: 'user-b', updated_by: ACTOR });
      expect(tables.ticket_resources).toHaveLength(0);
      expect(publishEventMock).toHaveBeenCalledWith({
        eventType: 'TICKET_ASSIGNED',
        payload: {
          tenantId: TENANT,
          ticketId: TICKET,
          userId: 'user-b',
          assignedByUserId: ACTOR,
        },
      });
    });

    it('rejects a duplicate additional agent as a conflict', async () => {
      const { addTicketResourceCore, TicketResourceError } = await import('../ticketResourceCore');
      await addTicketResourceCore(trx, TENANT, ACTOR, TICKET, 'user-b', 'support');

      const error = await addTicketResourceCore(trx, TENANT, ACTOR, TICKET, 'user-b', 'support')
        .catch((thrown) => thrown);

      expect(error).toBeInstanceOf(TicketResourceError);
      expect(error.kind).toBe('conflict');
      expect(tables.ticket_resources).toHaveLength(1);
    });

    it('reports a missing ticket as not found', async () => {
      const { addTicketResourceCore } = await import('../ticketResourceCore');

      await expect(
        addTicketResourceCore(trx, TENANT, ACTOR, 'missing-ticket', 'user-b', 'support')
      ).rejects.toMatchObject({ kind: 'not_found' });
    });
  });

  describe('removeTicketResourceCore', () => {
    it('removes the assignment row', async () => {
      const { addTicketResourceCore, removeTicketResourceCore } = await import('../ticketResourceCore');
      const resource = await addTicketResourceCore(trx, TENANT, ACTOR, TICKET, 'user-b', 'support');

      await removeTicketResourceCore(trx, TENANT, resource!.assignment_id!);

      expect(tables.ticket_resources).toHaveLength(0);
    });

    it('reports an unknown assignment as not found', async () => {
      const { removeTicketResourceCore } = await import('../ticketResourceCore');

      await expect(removeTicketResourceCore(trx, TENANT, 'nope')).rejects.toMatchObject({
        kind: 'not_found',
      });
    });
  });

  describe('getTicketResourcesCore', () => {
    it('returns the ticket resources newest first', async () => {
      tables.ticket_resources = [
        { assignment_id: 'a1', tenant: TENANT, ticket_id: TICKET, assigned_to: 'user-a', additional_user_id: 'user-b', assigned_at: new Date('2026-01-01') },
        { assignment_id: 'a2', tenant: TENANT, ticket_id: TICKET, assigned_to: 'user-a', additional_user_id: 'user-c', assigned_at: new Date('2026-02-01') },
        { assignment_id: 'a3', tenant: TENANT, ticket_id: 'other', assigned_to: 'user-a', additional_user_id: 'user-d', assigned_at: new Date('2026-03-01') },
      ];
      const { getTicketResourcesCore } = await import('../ticketResourceCore');

      const resources = await getTicketResourcesCore(trx, TENANT, TICKET);

      expect(resources.map((resource) => resource.additional_user_id)).toEqual(['user-c', 'user-b']);
    });

    it('reports a missing ticket as not found', async () => {
      const { getTicketResourcesCore } = await import('../ticketResourceCore');

      await expect(getTicketResourcesCore(trx, TENANT, 'missing-ticket')).rejects.toMatchObject({
        kind: 'not_found',
      });
    });
  });
});
