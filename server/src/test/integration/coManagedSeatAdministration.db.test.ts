/**
 * Co-managed seat and workspace shapes, slice S34 (F084–F086 / T044, server half) on real Postgres.
 *
 * What an MSP administrator reads and changes about seat arrangements: the chooser's pool and blocker,
 * the panel's technicians, the overview's seat rows, and the commands this slice adds: shared projects,
 * handoff defaults, and withdrawing or resending a pending invitation.
 */
import { randomUUID } from 'node:crypto';
import type { Knex } from 'knex';
import { afterAll, beforeAll, expect, it } from 'vitest';
import {
  acceptCoManagedSeatInvitation, createCoManagedSeatArrangement, inviteCoManagedSeatTechnician,
  readCoManagedSeatAdminOptions, readCoManagedSeatArrangementPanel, readCoManagedSeatEnableState,
  readCoManagedSeatOverviewRows, refreshCoManagedSeatInvitation, revokeCoManagedSeatInvitation,
  setCoManagedSeatBoardScope, setCoManagedSeatHandoffDefaults, setCoManagedSeatProjectGrants,
} from '@alga-psa/co-managed';
import { releaseCoManagedSeatAllocation } from '@alga-psa/licensing';
import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { describeWithDb } from '../../../test-utils/requireDb';
import { createClient, createTenant, createUser } from '../../../test-utils/testDataFactory';

const DAY = 86_400_000;
const describeDb = await describeWithDb();

describeDb('seat arrangement administration', { shuffle: false }, () => {
  let db: Knex;

  const sponsorWithPool = async (capacity: number) => {
    const sponsor = await createTenant(db, `Seat sponsor ${randomUUID().slice(0, 8)}`, { productCode: 'psa' });
    await db('co_managed_entitlements').insert({ tenant: sponsor, source: 'hosted', source_reference: `sub_${randomUUID()}`, capacity,
      verified_at: new Date(Date.now() - 400 * DAY), valid_until: new Date(Date.now() + 365 * DAY) });
    return sponsor;
  };
  const client = (sponsor: string, name = `Client ${randomUUID().slice(0, 8)}`, options: { is_inactive?: boolean } = {}) =>
    createClient(db, sponsor, name, options);
  const arrange = async (sponsorTenant: string, seats: number, clientId?: string) =>
    createCoManagedSeatArrangement(db, { sponsorTenant, clientId: clientId ?? await client(sponsorTenant), operationId: randomUUID(), seats });
  const board = async (tenant: string, name = `Board ${randomUUID().slice(0, 8)}`) => {
    const boardId = randomUUID();
    await db('boards').insert({ tenant, board_id: boardId, board_name: name, is_default: false });
    return boardId;
  };
  const project = async (tenant: string, clientId: string, name = `Project ${randomUUID().slice(0, 8)}`) => {
    const projectId = randomUUID();
    await db('projects').insert({ tenant, project_id: projectId, project_name: name, status: randomUUID(), wbs_code: '1', client_id: clientId, project_number: `P-${projectId.slice(0, 6)}` });
    return projectId;
  };
  const address = () => `tech.${randomUUID().slice(0, 12)}@client.example`;
  const revision = async (sponsor: string, arrangementId: string) =>
    (await db('co_managed_seat_arrangements').where({ tenant: sponsor, arrangement_id: arrangementId }).first('revision')).revision as number;

  beforeAll(async () => { db = await createTestDbConnection({ databaseName: 's34_seat_administration_test' }); }, 300_000);
  afterAll(async () => { await db?.destroy(); });

  // F084
  it('the chooser reads the pool and no blocker for a client that can be enabled', async () => {
    const sponsor = await sponsorWithPool(5);
    await arrange(sponsor, 2);
    const clientId = await client(sponsor, 'Acme');
    expect(await readCoManagedSeatEnableState(db, { sponsorTenant: sponsor, clientId })).toEqual({
      clientName: 'Acme', capacity: { purchased: 5, allocated: 2, available: 3 }, blocker: null });
  });

  // F084
  it('names the refusal enabling would meet: no pool, inactive client, no seats left, an existing arrangement', async () => {
    const bare = await createTenant(db, 'No pool', { productCode: 'psa' });
    expect(await readCoManagedSeatEnableState(db, { sponsorTenant: bare, clientId: await client(bare) }))
      .toMatchObject({ blocker: 'SPONSOR_NOT_ELIGIBLE', capacity: { purchased: 0, allocated: 0, available: 0 } });

    const sponsor = await sponsorWithPool(2);
    const inactive = await client(sponsor, 'Dormant', { is_inactive: true });
    expect(await readCoManagedSeatEnableState(db, { sponsorTenant: sponsor, clientId: inactive })).toMatchObject({ blocker: 'CLIENT_INACTIVE' });
    expect(await readCoManagedSeatEnableState(db, { sponsorTenant: sponsor, clientId: randomUUID() })).toMatchObject({ blocker: 'CLIENT_NOT_FOUND' });

    const arranged = await arrange(sponsor, 2);
    expect(await readCoManagedSeatEnableState(db, { sponsorTenant: sponsor, clientId: arranged.client_id })).toMatchObject({ blocker: 'CLIENT_HAS_ARRANGEMENT' });
    expect(await readCoManagedSeatEnableState(db, { sponsorTenant: sponsor, clientId: await client(sponsor) }))
      .toMatchObject({ blocker: 'CAPACITY_UNAVAILABLE', capacity: { purchased: 2, allocated: 2, available: 0 } });
  });

  // F084: the blockers are the commands' own refusals, so a stale reading cannot enable anything.
  it('the command still refuses what the chooser named', async () => {
    const sponsor = await sponsorWithPool(1);
    await arrange(sponsor, 1);
    await expect(arrange(sponsor, 1)).rejects.toMatchObject({ code: 'CAPACITY_UNAVAILABLE' });
  });

  // F085
  it('the panel lists technicians and pending invitations by name and counts the seats they hold', async () => {
    const sponsor = await sponsorWithPool(5);
    const arrangement = await arrange(sponsor, 3);
    expect(await readCoManagedSeatArrangementPanel(db, { sponsorTenant: sponsor, clientId: arrangement.client_id }))
      .toMatchObject({ arrangementId: arrangement.arrangement_id, seats: 3, usedSeats: 0, technicians: [], boardScope: [], sharedProjectIds: [], handoffDefaults: {} });

    const email = address();
    const invited = await inviteCoManagedSeatTechnician(db, { sponsorTenant: sponsor, arrangementId: arrangement.arrangement_id, email, firstName: 'Dana', lastName: 'Reyes' });
    const boardId = await board(sponsor);
    await setCoManagedSeatBoardScope(db, { sponsorTenant: sponsor, arrangementId: arrangement.arrangement_id, boards: [{ boardId, canCreate: true }] });

    const panel = await readCoManagedSeatArrangementPanel(db, { sponsorTenant: sponsor, clientId: arrangement.client_id });
    expect(panel).toMatchObject({ seats: 3, usedSeats: 1, boardScope: [{ boardId, canCreate: true }] });
    expect(panel?.technicians).toEqual([{ assignmentId: invited.assignment_id, state: 'invited', name: 'Dana Reyes', email,
      expiresAt: expect.any(String), expired: false }]);

    await acceptCoManagedSeatInvitation(db, { token: invited.token, password: 'Sup3r-secret-pass!' });
    const accepted = await readCoManagedSeatArrangementPanel(db, { sponsorTenant: sponsor, clientId: arrangement.client_id });
    expect(accepted?.technicians).toEqual([expect.objectContaining({ state: 'active', name: 'Dana Reyes', email, expiresAt: null, expired: false })]);
  });

  // F085
  it('there is no panel for a client without a live arrangement, and an ended arrangement is not one', async () => {
    const sponsor = await sponsorWithPool(3);
    expect(await readCoManagedSeatArrangementPanel(db, { sponsorTenant: sponsor, clientId: await client(sponsor) })).toBeNull();
    const arrangement = await arrange(sponsor, 1);
    await db('co_managed_seat_arrangements').where({ tenant: sponsor, arrangement_id: arrangement.arrangement_id })
      .update({ state: 'ended', ended_at: new Date() });
    expect(await readCoManagedSeatArrangementPanel(db, { sponsorTenant: sponsor, clientId: arrangement.client_id })).toBeNull();
  });

  // F085
  it('offers names to pick from: boards, the client\'s own projects and sponsor staff without seat technicians', async () => {
    const sponsor = await sponsorWithPool(3);
    const arrangement = await arrange(sponsor, 2);
    const other = await client(sponsor);
    await board(sponsor, 'Service desk');
    await project(sponsor, arrangement.client_id, 'Rollout');
    await project(sponsor, other, 'Somebody else');
    const staff = await createUser(db, sponsor, { user_type: 'internal', first_name: 'Sam', last_name: 'Staff' });
    const invited = await inviteCoManagedSeatTechnician(db, { sponsorTenant: sponsor, arrangementId: arrangement.arrangement_id, email: address(), firstName: 'Tess', lastName: 'Tech' });
    const accepted = await acceptCoManagedSeatInvitation(db, { token: invited.token, password: 'Sup3r-secret-pass!' });

    const options = await readCoManagedSeatAdminOptions(db, { sponsorTenant: sponsor, clientId: arrangement.client_id });
    expect(options.boards.map((entry) => entry.name)).toEqual(['Service desk']);
    expect(options.projects.map((entry) => entry.name)).toEqual(['Rollout']);
    expect(options.staff.map((entry) => entry.userId)).toContain(staff);
    expect(options.staff.map((entry) => entry.userId)).not.toContain(accepted.user_id);
  });

  // F086
  it('the overview reads every seat arrangement with the seats it holds and uses, ended ones holding none', async () => {
    const sponsor = await sponsorWithPool(10);
    const acme = await arrange(sponsor, 3, await client(sponsor, 'Acme'));
    const beta = await arrange(sponsor, 2, await client(sponsor, 'Beta'));
    await inviteCoManagedSeatTechnician(db, { sponsorTenant: sponsor, arrangementId: acme.arrangement_id, email: address(), firstName: 'A' });
    await inviteCoManagedSeatTechnician(db, { sponsorTenant: sponsor, arrangementId: acme.arrangement_id, email: address(), firstName: 'B' });
    await releaseCoManagedSeatAllocation(db, sponsor, { allocationId: beta.allocation_id });
    await db('co_managed_seat_arrangements').where({ tenant: sponsor, arrangement_id: beta.arrangement_id }).update({ state: 'ended', ended_at: new Date() });

    expect(await readCoManagedSeatOverviewRows(db, { sponsorTenant: sponsor })).toEqual([
      { arrangementId: acme.arrangement_id, clientId: acme.client_id, clientName: 'Acme', state: 'active', seats: 3, usedSeats: 2 },
      { arrangementId: beta.arrangement_id, clientId: beta.client_id, clientName: 'Beta', state: 'ended', seats: 0, usedSeats: 0 },
    ]);
    expect(await readCoManagedSeatOverviewRows(db, { sponsorTenant: sponsor, search: 'bet' })).toHaveLength(1);
    // Another sponsor's arrangements never appear.
    expect(await readCoManagedSeatOverviewRows(db, { sponsorTenant: await sponsorWithPool(1) })).toEqual([]);
  });

  // F085
  it('shares exactly the projects given, declaratively, and bumps the revision', async () => {
    const sponsor = await sponsorWithPool(3);
    const arrangement = await arrange(sponsor, 1);
    const a = await project(sponsor, arrangement.client_id);
    const b = await project(sponsor, arrangement.client_id);
    const before = await revision(sponsor, arrangement.arrangement_id);

    expect(await setCoManagedSeatProjectGrants(db, { sponsorTenant: sponsor, arrangementId: arrangement.arrangement_id, projectIds: [a, b] })).toEqual([a, b].sort());
    expect(await setCoManagedSeatProjectGrants(db, { sponsorTenant: sponsor, arrangementId: arrangement.arrangement_id, projectIds: [b] })).toEqual([b]);
    expect(await setCoManagedSeatProjectGrants(db, { sponsorTenant: sponsor, arrangementId: arrangement.arrangement_id, projectIds: [b] })).toEqual([b]);
    expect(await revision(sponsor, arrangement.arrangement_id)).toBe(before + 3);
    expect(await setCoManagedSeatProjectGrants(db, { sponsorTenant: sponsor, arrangementId: arrangement.arrangement_id, projectIds: [] })).toEqual([]);
  });

  // F085
  it('refuses project grants for an unknown project, a repeated one and an arrangement that is gone or ended', async () => {
    const sponsor = await sponsorWithPool(3);
    const arrangement = await arrange(sponsor, 1);
    const real = await project(sponsor, arrangement.client_id);
    const grant = (arrangementId: string, projectIds: string[]) => setCoManagedSeatProjectGrants(db, { sponsorTenant: sponsor, arrangementId, projectIds });

    await expect(grant(arrangement.arrangement_id, [randomUUID()])).rejects.toMatchObject({ code: 'PROJECT_NOT_FOUND' });
    await expect(grant(arrangement.arrangement_id, [real, real])).rejects.toMatchObject({ code: 'INVALID_PROJECT_GRANTS' });
    await expect(grant(arrangement.arrangement_id, ['nope'])).rejects.toMatchObject({ code: 'INVALID_PROJECT_GRANTS' });
    await expect(grant(randomUUID(), [real])).rejects.toMatchObject({ code: 'ARRANGEMENT_NOT_FOUND' });
    // A project of another sponsor is not this sponsor's to share.
    const foreign = await sponsorWithPool(1);
    await expect(grant(arrangement.arrangement_id, [await project(foreign, await client(foreign))])).rejects.toMatchObject({ code: 'PROJECT_NOT_FOUND' });
    expect(await db('co_managed_seat_project_grants').where({ tenant: sponsor })).toEqual([]);

    await db('co_managed_seat_arrangements').where({ tenant: sponsor, arrangement_id: arrangement.arrangement_id }).update({ state: 'ended', ended_at: new Date() });
    await expect(grant(arrangement.arrangement_id, [real])).rejects.toMatchObject({ code: 'ARRANGEMENT_ENDED' });
  });

  // F085
  it('sets and clears the handoff default assignee, accepting staff only', async () => {
    const sponsor = await sponsorWithPool(3);
    const arrangement = await arrange(sponsor, 2);
    const staff = await createUser(db, sponsor, { user_type: 'internal' });
    const set = (assignedTo?: string) => setCoManagedSeatHandoffDefaults(db, { sponsorTenant: sponsor, arrangementId: arrangement.arrangement_id,
      defaults: assignedTo ? { assigned_to: assignedTo } : {} });

    expect(await set(staff)).toEqual({ assigned_to: staff });
    expect((await readCoManagedSeatArrangementPanel(db, { sponsorTenant: sponsor, clientId: arrangement.client_id }))?.handoffDefaults).toEqual({ assigned_to: staff });
    expect(await set()).toEqual({});

    const portalUser = await createUser(db, sponsor, { user_type: 'client' });
    await expect(set(portalUser)).rejects.toMatchObject({ code: 'USER_NOT_FOUND' });
    await expect(set(randomUUID())).rejects.toMatchObject({ code: 'USER_NOT_FOUND' });
    await expect(set('nope')).rejects.toMatchObject({ code: 'INVALID_HANDOFF_DEFAULTS' });
    const invited = await inviteCoManagedSeatTechnician(db, { sponsorTenant: sponsor, arrangementId: arrangement.arrangement_id, email: address(), firstName: 'Tess' });
    const technician = await acceptCoManagedSeatInvitation(db, { token: invited.token, password: 'Sup3r-secret-pass!' });
    await expect(set(technician.user_id)).rejects.toMatchObject({ code: 'USER_NOT_FOUND' });
  });

  // F085
  it('withdrawing a pending invitation gives its seat back and spends the link', async () => {
    const sponsor = await sponsorWithPool(3);
    const arrangement = await arrange(sponsor, 1);
    const invited = await inviteCoManagedSeatTechnician(db, { sponsorTenant: sponsor, arrangementId: arrangement.arrangement_id, email: address(), firstName: 'Dana' });
    await expect(inviteCoManagedSeatTechnician(db, { sponsorTenant: sponsor, arrangementId: arrangement.arrangement_id, email: address(), firstName: 'Full' }))
      .rejects.toMatchObject({ code: 'SEAT_LIMIT' });

    expect(await revokeCoManagedSeatInvitation(db, { sponsorTenant: sponsor, assignmentId: invited.assignment_id })).toEqual({ revoked: true });
    expect(await revokeCoManagedSeatInvitation(db, { sponsorTenant: sponsor, assignmentId: invited.assignment_id })).toEqual({ revoked: false });
    expect(await db('co_managed_seat_assignments').where({ tenant: sponsor, assignment_id: invited.assignment_id }).first())
      .toMatchObject({ state: 'revoked', revoked_at: expect.any(Date) });
    expect(await db('user_invitations').where({ tenant: sponsor, invitation_id: invited.invitation_id }).first())
      .toMatchObject({ used_at: expect.any(Date), metadata: expect.objectContaining({ revoked: true }) });
    await expect(acceptCoManagedSeatInvitation(db, { token: invited.token, password: 'Sup3r-secret-pass!' })).rejects.toMatchObject({ code: 'INVITATION_REVOKED' });

    // The seat is free again.
    await inviteCoManagedSeatTechnician(db, { sponsorTenant: sponsor, arrangementId: arrangement.arrangement_id, email: address(), firstName: 'Next' });
  });

  // F085: accepted technicians are revoked by a command this slice does not have.
  it('does not revoke an accepted technician', async () => {
    const sponsor = await sponsorWithPool(3);
    const arrangement = await arrange(sponsor, 1);
    const invited = await inviteCoManagedSeatTechnician(db, { sponsorTenant: sponsor, arrangementId: arrangement.arrangement_id, email: address(), firstName: 'Dana' });
    await acceptCoManagedSeatInvitation(db, { token: invited.token, password: 'Sup3r-secret-pass!' });
    await expect(revokeCoManagedSeatInvitation(db, { sponsorTenant: sponsor, assignmentId: invited.assignment_id })).rejects.toMatchObject({ code: 'ASSIGNMENT_NOT_PENDING' });
    await expect(revokeCoManagedSeatInvitation(db, { sponsorTenant: sponsor, assignmentId: randomUUID() })).rejects.toMatchObject({ code: 'INVITATION_NOT_FOUND' });
  });

  // F085
  it('resending rotates the token and restarts the 24 hours without taking another seat', async () => {
    const sponsor = await sponsorWithPool(3);
    const arrangement = await arrange(sponsor, 1);
    const email = address();
    const invited = await inviteCoManagedSeatTechnician(db, { sponsorTenant: sponsor, arrangementId: arrangement.arrangement_id, email, firstName: 'Dana', lastName: 'Reyes' });
    await db('user_invitations').where({ tenant: sponsor, invitation_id: invited.invitation_id }).update({ expires_at: new Date(Date.now() - 1000) });

    const refreshed = await refreshCoManagedSeatInvitation(db, { sponsorTenant: sponsor, assignmentId: invited.assignment_id });
    expect(refreshed).toMatchObject({ assignment_id: invited.assignment_id, email, firstName: 'Dana', lastName: 'Reyes', token: expect.stringMatching(/^[0-9a-f]{64}$/) });
    expect(refreshed.token).not.toBe(invited.token);
    expect(await db('co_managed_seat_assignments').where({ tenant: sponsor, arrangement_id: arrangement.arrangement_id }).whereNot('state', 'revoked')).toHaveLength(1);
    await expect(acceptCoManagedSeatInvitation(db, { token: invited.token, password: 'Sup3r-secret-pass!' })).rejects.toMatchObject({ code: 'INVITATION_NOT_FOUND' });
    expect(await acceptCoManagedSeatInvitation(db, { token: refreshed.token, password: 'Sup3r-secret-pass!' })).toMatchObject({ created: true, email });
    await expect(refreshCoManagedSeatInvitation(db, { sponsorTenant: sponsor, assignmentId: invited.assignment_id })).rejects.toMatchObject({ code: 'ASSIGNMENT_NOT_PENDING' });
  });

  it('refuses to resend a withdrawn invitation', async () => {
    const sponsor = await sponsorWithPool(3);
    const arrangement = await arrange(sponsor, 1);
    const invited = await inviteCoManagedSeatTechnician(db, { sponsorTenant: sponsor, arrangementId: arrangement.arrangement_id, email: address(), firstName: 'Dana' });
    await revokeCoManagedSeatInvitation(db, { sponsorTenant: sponsor, assignmentId: invited.assignment_id });
    await expect(refreshCoManagedSeatInvitation(db, { sponsorTenant: sponsor, assignmentId: invited.assignment_id })).rejects.toMatchObject({ code: 'ASSIGNMENT_NOT_PENDING' });
  });
});
