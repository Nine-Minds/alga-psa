// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FakeTables } from './fakeTenantTables';

let tables: FakeTables = {};

vi.mock('@alga-psa/db', async () => {
  const { createTenantDbMock } = await import('./fakeTenantTables');
  return { tenantDb: createTenantDbMock(() => tables) };
});

const TENANT = 'tenant-1';
const TICKET = 'ticket-1';

async function reassign(currentAssignedTo: string | null, newAssignedTo: string | null) {
  const { prepareTicketResourceReassignment } = await import('../reassignTicketResources');
  const finalize = await prepareTicketResourceReassignment(
    {} as any,
    TENANT,
    TICKET,
    currentAssignedTo,
    newAssignedTo
  );
  await finalize();
  return tables.ticket_resources ?? [];
}

describe('prepareTicketResourceReassignment', () => {
  beforeEach(() => {
    tables = {
      ticket_resources: [
        { assignment_id: 'a1', tenant: TENANT, ticket_id: TICKET, assigned_to: 'user-a', additional_user_id: 'user-c', role: 'support' },
        { assignment_id: 'a2', tenant: TENANT, ticket_id: TICKET, assigned_to: 'user-a', additional_user_id: 'user-d', role: 'team_member' },
        { assignment_id: 'a3', tenant: TENANT, ticket_id: 'other-ticket', assigned_to: 'user-a', additional_user_id: 'user-e', role: 'support' },
      ],
    };
  });

  it('re-keys the additional agents to the new primary assignee', async () => {
    const resources = await reassign('user-a', 'user-b');

    const forTicket = resources.filter((row) => row.ticket_id === TICKET);
    expect(forTicket).toHaveLength(2);
    expect(forTicket.every((row) => row.assigned_to === 'user-b')).toBe(true);
    expect(forTicket.map((row) => row.additional_user_id).sort()).toEqual(['user-c', 'user-d']);
    expect(forTicket.map((row) => row.role).sort()).toEqual(['support', 'team_member']);
  });

  it('leaves other tickets alone', async () => {
    const resources = await reassign('user-a', 'user-b');

    expect(resources.find((row) => row.assignment_id === 'a3')).toMatchObject({
      ticket_id: 'other-ticket',
      assigned_to: 'user-a',
    });
  });

  it('absorbs an additional agent who becomes the primary assignee', async () => {
    const resources = await reassign('user-a', 'user-c');

    const forTicket = resources.filter((row) => row.ticket_id === TICKET);
    expect(forTicket).toHaveLength(1);
    expect(forTicket[0]).toMatchObject({ assigned_to: 'user-c', additional_user_id: 'user-d' });
  });

  it('drops the additional agents when the ticket is unassigned', async () => {
    const resources = await reassign('user-a', null);

    expect(resources.filter((row) => row.ticket_id === TICKET)).toHaveLength(0);
  });

  it('is a no-op when the ticket had no primary assignee', async () => {
    const resources = await reassign(null, 'user-b');

    expect(resources).toHaveLength(3);
  });
});
