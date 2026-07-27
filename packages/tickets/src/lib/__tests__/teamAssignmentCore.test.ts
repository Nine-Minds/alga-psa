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
const TEAM = 'team-1';
const ACTOR = 'user-actor';

const trx = {} as any;

function seed(overrides: Partial<FakeTables> = {}) {
  tables = {
    tickets: [{ tenant: TENANT, ticket_id: TICKET, assigned_to: null, assigned_team_id: null }],
    teams: [{ tenant: TENANT, team_id: TEAM, manager_id: 'user-lead' }],
    team_members: [
      { tenant: TENANT, team_id: TEAM, user_id: 'user-lead', is_inactive: false },
      { tenant: TENANT, team_id: TEAM, user_id: 'user-b', is_inactive: false },
      { tenant: TENANT, team_id: TEAM, user_id: 'user-inactive', is_inactive: true },
    ],
    ticket_resources: [],
    ...overrides,
  };
}

describe('assignTeamToTicketCore', () => {
  beforeEach(() => seed());

  it('falls back to the team lead as primary agent and adds the active members', async () => {
    const { assignTeamToTicketCore } = await import('../teamAssignmentCore');

    const assignedTo = await assignTeamToTicketCore(trx, TENANT, ACTOR, TICKET, TEAM);

    expect(assignedTo).toBe('user-lead');
    expect(tables.tickets[0]).toMatchObject({
      assigned_team_id: TEAM,
      assigned_to: 'user-lead',
      updated_by: ACTOR,
    });
    expect(tables.ticket_resources).toHaveLength(1);
    expect(tables.ticket_resources[0]).toMatchObject({
      ticket_id: TICKET,
      assigned_to: 'user-lead',
      additional_user_id: 'user-b',
      role: 'team_member',
    });
  });

  it('keeps an existing primary agent and keys the members to them', async () => {
    tables.tickets[0].assigned_to = 'user-a';
    const { assignTeamToTicketCore } = await import('../teamAssignmentCore');

    const assignedTo = await assignTeamToTicketCore(trx, TENANT, ACTOR, TICKET, TEAM);

    expect(assignedTo).toBe('user-a');
    expect(tables.ticket_resources.map((row) => row.additional_user_id).sort()).toEqual([
      'user-b',
      'user-lead',
    ]);
    expect(tables.ticket_resources.every((row) => row.assigned_to === 'user-a')).toBe(true);
  });

  it('does not duplicate members who are already additional agents', async () => {
    tables.tickets[0].assigned_to = 'user-a';
    tables.ticket_resources.push({
      assignment_id: 'existing',
      tenant: TENANT,
      ticket_id: TICKET,
      assigned_to: 'user-a',
      additional_user_id: 'user-b',
      role: 'support',
    });
    const { assignTeamToTicketCore } = await import('../teamAssignmentCore');

    await assignTeamToTicketCore(trx, TENANT, ACTOR, TICKET, TEAM);

    expect(tables.ticket_resources.filter((row) => row.additional_user_id === 'user-b')).toHaveLength(1);
    expect(tables.ticket_resources.find((row) => row.additional_user_id === 'user-b')?.role).toBe('support');
  });

  it('rejects a team without a lead', async () => {
    tables.teams[0].manager_id = null;
    const { assignTeamToTicketCore } = await import('../teamAssignmentCore');

    await expect(assignTeamToTicketCore(trx, TENANT, ACTOR, TICKET, TEAM)).rejects.toThrow(
      'Team lead not found'
    );
  });

  it('rejects an unknown ticket or team', async () => {
    const { assignTeamToTicketCore } = await import('../teamAssignmentCore');

    await expect(assignTeamToTicketCore(trx, TENANT, ACTOR, 'missing', TEAM)).rejects.toThrow('Ticket not found');
    await expect(assignTeamToTicketCore(trx, TENANT, ACTOR, TICKET, 'missing')).rejects.toThrow('Team not found');
  });
});

describe('removeTeamFromTicketCore', () => {
  beforeEach(() => {
    seed();
    tables.tickets[0].assigned_team_id = TEAM;
    tables.tickets[0].assigned_to = 'user-a';
    tables.ticket_resources = [
      { assignment_id: 'r1', tenant: TENANT, ticket_id: TICKET, assigned_to: 'user-a', additional_user_id: 'user-b', role: 'team_member' },
      { assignment_id: 'r2', tenant: TENANT, ticket_id: TICKET, assigned_to: 'user-a', additional_user_id: 'user-c', role: 'team_member' },
      { assignment_id: 'r3', tenant: TENANT, ticket_id: TICKET, assigned_to: 'user-a', additional_user_id: 'user-d', role: 'support' },
    ];
  });

  it('remove_all drops the team members but keeps other additional agents', async () => {
    const { removeTeamFromTicketCore } = await import('../teamAssignmentCore');

    await removeTeamFromTicketCore(trx, TENANT, ACTOR, TICKET, { mode: 'remove_all' });

    expect(tables.tickets[0].assigned_team_id).toBeNull();
    expect(tables.ticket_resources.map((row) => row.assignment_id)).toEqual(['r3']);
  });

  it('keep_all leaves every additional agent in place', async () => {
    const { removeTeamFromTicketCore } = await import('../teamAssignmentCore');

    await removeTeamFromTicketCore(trx, TENANT, ACTOR, TICKET, { mode: 'keep_all' });

    expect(tables.tickets[0].assigned_team_id).toBeNull();
    expect(tables.ticket_resources).toHaveLength(3);
  });

  it('selective keeps only the listed team members', async () => {
    const { removeTeamFromTicketCore } = await import('../teamAssignmentCore');

    await removeTeamFromTicketCore(trx, TENANT, ACTOR, TICKET, {
      mode: 'selective',
      keepUserIds: ['user-c'],
    });

    expect(tables.ticket_resources.map((row) => row.assignment_id).sort()).toEqual(['r2', 'r3']);
  });

  it('rejects an unknown ticket', async () => {
    const { removeTeamFromTicketCore } = await import('../teamAssignmentCore');

    await expect(
      removeTeamFromTicketCore(trx, TENANT, ACTOR, 'missing', { mode: 'remove_all' })
    ).rejects.toThrow('Ticket not found');
  });
});
