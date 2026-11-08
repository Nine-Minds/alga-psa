import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';

const state = vi.hoisted(() => ({
  rows: [] as Record<string, unknown>[],
  userLookups: 0,
  userType: 'internal',
}));

vi.mock('@alga-psa/db', async (importOriginal) => ({
  ...await importOriginal() as typeof import('@alga-psa/db'),
  tenantDb: () => ({
    table: (table: string) => {
      const query = {
        where: () => query,
        forShare: () => query,
        first: async () => {
          if (table === 'collaboration_actor_references') return { display_name: 'Partner technician', organization_name: 'Partner MSP' };
          state.userLookups += 1;
          return { user_type: state.userType };
        },
        insert: async (row: Record<string, unknown>) => { state.rows.push(row); },
      };
      return query;
    },
  }),
}));

import { writeTicketActivity } from '@alga-psa/shared/lib/ticketActivity/writeTicketActivity';
import { TICKET_ACTIVITY_ACTOR, TICKET_ACTIVITY_ENTITY, TICKET_ACTIVITY_EVENT, TICKET_ACTIVITY_SOURCE } from '@alga-psa/shared/lib/ticketActivity/types';

const trx = { isTransaction: true } as Knex.Transaction;
const write = (actor: Parameters<typeof writeTicketActivity>[1]['actor']) => writeTicketActivity(trx, {
  tenant: 'tenant-1',
  ticketId: 'ticket-1',
  eventType: TICKET_ACTIVITY_EVENT.UPDATED,
  entityType: TICKET_ACTIVITY_ENTITY.TICKET,
  source: TICKET_ACTIVITY_SOURCE.API,
  actor,
});

describe('ticket activity attribution after the main merge', () => {
  beforeEach(() => {
    state.rows = [];
    state.userLookups = 0;
    state.userType = 'internal';
  });

  it('keeps foreign actors in owner-local references without inventing a user FK', async () => {
    const referenceId = '11111111-1111-4111-8111-111111111111';
    await write({ actorType: TICKET_ACTIVITY_ACTOR.USER, actorReferenceId: referenceId });
    expect(state.rows[0]).toMatchObject({
      actor_type: TICKET_ACTIVITY_ACTOR.USER,
      actor_user_id: null,
      actor_contact_id: null,
      actor_reference_id: referenceId,
      actor_display_name: 'Partner technician',
      actor_organization_name: 'Partner MSP',
    });
    expect(state.rows[0]).not.toHaveProperty('via_principal_user_id');
  });

  it('writes interactive activity with a supplied identity without another user lookup', async () => {
    await writeTicketActivity(trx, {
      tenant: 'tenant-1', ticketId: 'ticket-1',
      eventType: TICKET_ACTIVITY_EVENT.UPDATED, entityType: TICKET_ACTIVITY_ENTITY.TICKET,
      source: TICKET_ACTIVITY_SOURCE.UI,
      actor: { actorType: TICKET_ACTIVITY_ACTOR.USER, userId: 'human-1', displayName: 'Technician' },
    });
    expect(state.userLookups).toBe(0);
    expect(state.rows[0]).toMatchObject({ actor_type: TICKET_ACTIVITY_ACTOR.USER, actor_user_id: 'human-1' });
  });

  it('records a bare service user as a service principal', async () => {
    state.userType = 'service';
    await write({ actorType: TICKET_ACTIVITY_ACTOR.API, userId: 'principal-1', displayName: 'Integration' });
    expect(state.rows[0]).toMatchObject({ actor_type: TICKET_ACTIVITY_ACTOR.SERVICE_PRINCIPAL, actor_user_id: 'principal-1' });
  });

  it('records the human actor and via principal for delegated API activity', async () => {
    await write({ actorType: TICKET_ACTIVITY_ACTOR.API, userId: 'human-1', displayName: 'Technician', viaPrincipalUserId: 'principal-1' });
    expect(state.rows[0]).toMatchObject({ actor_type: TICKET_ACTIVITY_ACTOR.USER, actor_user_id: 'human-1', via_principal_user_id: 'principal-1' });
  });

  it('retains main’s rejection of mixed foreign and customer-local identities', async () => {
    await expect(write({ actorType: TICKET_ACTIVITY_ACTOR.USER, userId: 'human-1', actorReferenceId: '11111111-1111-4111-8111-111111111111' }))
      .rejects.toThrow('exclusive actor reference');
    expect(state.rows).toEqual([]);
  });
});
