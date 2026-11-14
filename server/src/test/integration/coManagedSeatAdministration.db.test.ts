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
  readCoManagedSeatContactChoices,
  acceptCoManagedSeatInvitation, createCoManagedSeatArrangement, inviteCoManagedSeatTechnician,
  readCoManagedSeatAdminOptions, readCoManagedSeatArrangementPanel, readCoManagedSeatEnableState,
  readCoManagedSeatOverviewRows, refreshCoManagedSeatInvitation, revokeCoManagedSeatInvitation,
  setCoManagedSeatBoardScope, setCoManagedSeatHandoffDefaults, setCoManagedSeatProjectGrants,
} from '@alga-psa/co-managed';
import { releaseCoManagedSeatAllocation } from '@alga-psa/licensing';
import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { describeWithDb } from '../../../test-utils/requireDb';
import { createClient, createContact, createTenant, createUser } from '../../../test-utils/testDataFactory';

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
  // One project status per tenant: names and order numbers of non-ticket statuses are unique.
  const projectStatus = async (tenant: string) => {
    const existing = await db('statuses').where({ tenant, status_type: 'project' }).first('status_id');
    if (existing) return existing.status_id as string;
    const statusId = randomUUID();
    await db('statuses').insert({ tenant, status_id: statusId, name: 'Open', status_type: 'project', item_type: 'project', order_number: 1, is_closed: false });
    return statusId;
  };
  const project = async (tenant: string, clientId: string, name = `Project ${randomUUID().slice(0, 8)}`) => {
    const projectId = randomUUID();
    await db('projects').insert({ tenant, project_id: projectId, project_name: name, status: await projectStatus(tenant), wbs_code: projectId.slice(0, 8), client_id: clientId, project_number: `P-${projectId.slice(0, 6)}` });
    return projectId;
  };
  const address = () => `tech.${randomUUID().slice(0, 12)}@client.example`;
  /** Invites a new contact of the arrangement's client (name and email as given), the way the panel does. */
  const invite = async (sponsorTenant: string, arrangementId: string, options: { email?: string | null; name?: string } = {}) => {
    const { client_id } = await db('co_managed_seat_arrangements').where({ tenant: sponsorTenant, arrangement_id: arrangementId }).first('client_id');
    const contactId = await createContact(db, sponsorTenant, client_id, { fullName: options.name ?? 'Dana Reyes', email: options.email === undefined ? address() : options.email });
    return inviteCoManagedSeatTechnician(db, { sponsorTenant, arrangementId, contactId });
  };
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
    const invited = await invite(sponsor, arrangement.arrangement_id, { email, name: 'Dana Reyes' });
    const boardId = await board(sponsor);
    await setCoManagedSeatBoardScope(db, { sponsorTenant: sponsor, arrangementId: arrangement.arrangement_id, boards: [{ boardId, canCreate: true }] });

    const panel = await readCoManagedSeatArrangementPanel(db, { sponsorTenant: sponsor, clientId: arrangement.client_id });
    expect(panel).toMatchObject({ seats: 3, usedSeats: 1, boardScope: [{ boardId, canCreate: true }] });
    expect(panel?.technicians).toEqual([{ assignmentId: invited.assignment_id, contactId: invited.contact_id, state: 'invited', name: 'Dana Reyes', email,
      expiresAt: expect.any(String), expired: false }]);

    await acceptCoManagedSeatInvitation(db, { token: invited.token, password: 'Sup3r-secret-pass!' });
    const accepted = await readCoManagedSeatArrangementPanel(db, { sponsorTenant: sponsor, clientId: arrangement.client_id });
    expect(accepted?.technicians).toEqual([expect.objectContaining({ state: 'active', contactId: invited.contact_id, name: 'Dana Reyes', email, expiresAt: null, expired: false })]);
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
    const invited = await invite(sponsor, arrangement.arrangement_id, { email: address(), name: 'Tess Tech' });
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
    await invite(sponsor, acme.arrangement_id, { email: address(), name: 'A' });
    await invite(sponsor, acme.arrangement_id, { email: address(), name: 'B' });
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
    const invited = await invite(sponsor, arrangement.arrangement_id, { email: address(), name: 'Tess' });
    const technician = await acceptCoManagedSeatInvitation(db, { token: invited.token, password: 'Sup3r-secret-pass!' });
    await expect(set(technician.user_id)).rejects.toMatchObject({ code: 'USER_NOT_FOUND' });
  });

  // F085
  it('withdrawing a pending invitation gives its seat back and spends the link', async () => {
    const sponsor = await sponsorWithPool(3);
    const arrangement = await arrange(sponsor, 1);
    const invited = await invite(sponsor, arrangement.arrangement_id, { email: address(), name: 'Dana' });
    await expect(invite(sponsor, arrangement.arrangement_id, { email: address(), name: 'Full' }))
      .rejects.toMatchObject({ code: 'SEAT_LIMIT' });

    expect(await revokeCoManagedSeatInvitation(db, { sponsorTenant: sponsor, assignmentId: invited.assignment_id })).toEqual({ revoked: true });
    expect(await revokeCoManagedSeatInvitation(db, { sponsorTenant: sponsor, assignmentId: invited.assignment_id })).toEqual({ revoked: false });
    expect(await db('co_managed_seat_assignments').where({ tenant: sponsor, assignment_id: invited.assignment_id }).first())
      .toMatchObject({ state: 'revoked', revoked_at: expect.any(Date) });
    expect(await db('user_invitations').where({ tenant: sponsor, invitation_id: invited.invitation_id }).first())
      .toMatchObject({ used_at: expect.any(Date), metadata: expect.objectContaining({ revoked: true }) });
    await expect(acceptCoManagedSeatInvitation(db, { token: invited.token, password: 'Sup3r-secret-pass!' })).rejects.toMatchObject({ code: 'INVITATION_REVOKED' });

    // The seat is free again.
    await invite(sponsor, arrangement.arrangement_id, { email: address(), name: 'Next' });
  });

  // F085: accepted technicians are revoked by a command this slice does not have.
  it('does not revoke an accepted technician', async () => {
    const sponsor = await sponsorWithPool(3);
    const arrangement = await arrange(sponsor, 1);
    const invited = await invite(sponsor, arrangement.arrangement_id, { email: address(), name: 'Dana' });
    await acceptCoManagedSeatInvitation(db, { token: invited.token, password: 'Sup3r-secret-pass!' });
    await expect(revokeCoManagedSeatInvitation(db, { sponsorTenant: sponsor, assignmentId: invited.assignment_id })).rejects.toMatchObject({ code: 'ASSIGNMENT_NOT_PENDING' });
    await expect(revokeCoManagedSeatInvitation(db, { sponsorTenant: sponsor, assignmentId: randomUUID() })).rejects.toMatchObject({ code: 'INVITATION_NOT_FOUND' });
  });

  // F085
  it('resending rotates the token and restarts the 24 hours without taking another seat', async () => {
    const sponsor = await sponsorWithPool(3);
    const arrangement = await arrange(sponsor, 1);
    const email = address();
    const invited = await invite(sponsor, arrangement.arrangement_id, { email, name: 'Dana Reyes' });
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
    const invited = await invite(sponsor, arrangement.arrangement_id, { email: address(), name: 'Dana' });
    await revokeCoManagedSeatInvitation(db, { sponsorTenant: sponsor, assignmentId: invited.assignment_id });
    await expect(refreshCoManagedSeatInvitation(db, { sponsorTenant: sponsor, assignmentId: invited.assignment_id })).rejects.toMatchObject({ code: 'ASSIGNMENT_NOT_PENDING' });
  });

  // F085: a technician is a contact of the arrangement's client; the contact row is the only source of the name and email.
  describe('seat technicians are picked from the client\'s contacts', () => {
    const attempt = (sponsorTenant: string, arrangementId: string, contactId: string) =>
      inviteCoManagedSeatTechnician(db, { sponsorTenant, arrangementId, contactId });
    const stored = async (sponsor: string, assignmentId: string) => {
      const assignment = await db('co_managed_seat_assignments').where({ tenant: sponsor, assignment_id: assignmentId }).first();
      const invitation = await db('user_invitations').where({ tenant: sponsor, invitation_id: assignment.invitation_id }).first();
      return { assignment, invitation };
    };

    it('stores the contact on the assignment and takes the name and email from the contact row', async () => {
      const sponsor = await sponsorWithPool(5);
      const arrangement = await arrange(sponsor, 2);
      const contactId = await createContact(db, sponsor, arrangement.client_id, { fullName: 'Dana Mae Reyes', email: ' Dana@S34-Review.Example ' });
      const invited = await attempt(sponsor, arrangement.arrangement_id, contactId);
      const { assignment, invitation } = await stored(sponsor, invited.assignment_id);
      expect(assignment).toMatchObject({ contact_id: contactId, state: 'invited' });
      expect(invitation).toMatchObject({ email: 'dana@s34-review.example', first_name: 'Dana', last_name: 'Mae Reyes' });
      expect(invited).toMatchObject({ contact_id: contactId, email: 'dana@s34-review.example', firstName: 'Dana', lastName: 'Mae Reyes' });
      // The panel shows the contact's name and names the contact for its link.
      const panel = await readCoManagedSeatArrangementPanel(db, { sponsorTenant: sponsor, clientId: arrangement.client_id });
      expect(panel?.technicians).toEqual([expect.objectContaining({ contactId, name: 'Dana Mae Reyes' })]);
      // Renaming the contact before acceptance does not change who the invitation was for; the contact's name is shown.
      await db('contacts').where({ tenant: sponsor, contact_name_id: contactId }).update({ full_name: 'Dana Reyes-Moore' });
      expect((await readCoManagedSeatArrangementPanel(db, { sponsorTenant: sponsor, clientId: arrangement.client_id }))?.technicians[0].name).toBe('Dana Reyes-Moore');
    });

    it('is declarative on the contact: a second invitation of the same contact returns the first and takes no seat', async () => {
      const sponsor = await sponsorWithPool(5);
      const arrangement = await arrange(sponsor, 2);
      const contactId = await createContact(db, sponsor, arrangement.client_id, { fullName: 'Dana Reyes' });
      const first = await attempt(sponsor, arrangement.arrangement_id, contactId);
      expect(await attempt(sponsor, arrangement.arrangement_id, contactId)).toEqual({ ...first, created: false });
      expect(await db('co_managed_seat_assignments').where({ tenant: sponsor }).whereNot('state', 'revoked')).toHaveLength(1);
    });

    it('refuses a contact of another client', async () => {
      const sponsor = await sponsorWithPool(5);
      const arrangement = await arrange(sponsor, 2);
      const other = await client(sponsor);
      const contactId = await createContact(db, sponsor, other, { fullName: 'Not Theirs' });
      await expect(attempt(sponsor, arrangement.arrangement_id, contactId)).rejects.toMatchObject({ code: 'CONTACT_WRONG_CLIENT' });
      expect(await db('co_managed_seat_assignments').where({ tenant: sponsor })).toHaveLength(0);
      expect(await db('user_invitations').where({ tenant: sponsor })).toHaveLength(0);
    });

    it("refuses a contact that does not exist or belongs to another tenant", async () => {
      const sponsor = await sponsorWithPool(5);
      const arrangement = await arrange(sponsor, 2);
      await expect(attempt(sponsor, arrangement.arrangement_id, randomUUID())).rejects.toMatchObject({ code: 'CONTACT_NOT_FOUND' });
      const foreign = await sponsorWithPool(1);
      const foreignContact = await createContact(db, foreign, await client(foreign), { fullName: 'Elsewhere' });
      await expect(attempt(sponsor, arrangement.arrangement_id, foreignContact)).rejects.toMatchObject({ code: 'CONTACT_NOT_FOUND' });
      expect(await db('co_managed_seat_assignments').where({ tenant: sponsor })).toHaveLength(0);
    });

    it('refuses an inactive contact and a contact with no email, each by name', async () => {
      const sponsor = await sponsorWithPool(5);
      const arrangement = await arrange(sponsor, 3);
      const inactive = await createContact(db, sponsor, arrangement.client_id, { fullName: 'Gone', isInactive: true });
      await expect(attempt(sponsor, arrangement.arrangement_id, inactive)).rejects.toMatchObject({ code: 'CONTACT_INACTIVE' });
      for (const email of [null, '', '   ', 'not-an-email']) {
        const contactId = await createContact(db, sponsor, arrangement.client_id, { fullName: 'No Mail', email });
        await expect(attempt(sponsor, arrangement.arrangement_id, contactId)).rejects.toMatchObject({ code: 'CONTACT_NO_EMAIL' });
      }
      expect(await db('co_managed_seat_assignments').where({ tenant: sponsor })).toHaveLength(0);
    });

    it('refuses a contact who already holds a seat or pending invitation on any arrangement, and frees them on withdrawal', async () => {
      const sponsor = await sponsorWithPool(6);
      const arrangement = await arrange(sponsor, 3);
      const contactId = await createContact(db, sponsor, arrangement.client_id, { fullName: 'Dana Reyes' });
      const first = await attempt(sponsor, arrangement.arrangement_id, contactId);

      // Pending on another arrangement of the same sponsor: refused, whichever client the contact belongs to.
      const elsewhere = await arrange(sponsor, 1);
      await expect(attempt(sponsor, elsewhere.arrangement_id, contactId)).rejects.toMatchObject({ code: 'CONTACT_HAS_SEAT' });

      // Accepted: still holding.
      await acceptCoManagedSeatInvitation(db, { token: first.token, password: 'Sup3r-secret-pass!' });
      await expect(attempt(sponsor, arrangement.arrangement_id, contactId)).rejects.toMatchObject({ code: 'CONTACT_HAS_SEAT' });
      expect(await db('co_managed_seat_assignments').where({ tenant: sponsor, contact_id: contactId }).whereNot('state', 'revoked')).toHaveLength(1);

      // A withdrawn invitation frees the contact.
      const other = await createContact(db, sponsor, arrangement.client_id, { fullName: 'Sam Pending' });
      const pending = await attempt(sponsor, arrangement.arrangement_id, other);
      await revokeCoManagedSeatInvitation(db, { sponsorTenant: sponsor, assignmentId: pending.assignment_id });
      await expect(attempt(sponsor, arrangement.arrangement_id, other)).resolves.toMatchObject({ created: true });
    });

    it('the database allows one live seat per contact and refuses a contact of another tenant', async () => {
      const sponsor = await sponsorWithPool(5);
      const arrangement = await arrange(sponsor, 2);
      const contactId = await createContact(db, sponsor, arrangement.client_id, { fullName: 'Dana Reyes' });
      const row = (assignmentId: string) => ({ tenant: sponsor, assignment_id: assignmentId, arrangement_id: arrangement.arrangement_id, state: 'invited', contact_id: contactId });
      await db('co_managed_seat_assignments').insert(row(randomUUID()));
      await expect(db('co_managed_seat_assignments').insert(row(randomUUID()))).rejects.toMatchObject({ constraint: 'co_managed_one_live_seat_per_contact' });
      await db('co_managed_seat_assignments').where({ tenant: sponsor, contact_id: contactId })
        .update({ state: 'revoked', revoked_at: new Date() });
      await expect(db('co_managed_seat_assignments').insert(row(randomUUID()))).resolves.toBeDefined();
      const foreign = await sponsorWithPool(1);
      const foreignContact = await createContact(db, foreign, await client(foreign), { fullName: 'Elsewhere' });
      await expect(db('co_managed_seat_assignments').insert({ ...row(randomUUID()), contact_id: foreignContact })).rejects.toBeDefined();
    });

    it('offers the client\'s contacts with the first reason each cannot be invited, and no other client\'s', async () => {
      const sponsor = await sponsorWithPool(5);
      const arrangement = await arrange(sponsor, 3);
      const clientId = arrangement.client_id;
      const ready = await createContact(db, sponsor, clientId, { fullName: 'Dana Reyes', email: 'dana@s34-review.example' });
      const inactive = await createContact(db, sponsor, clientId, { fullName: 'Ines Inactive', isInactive: true });
      const noEmail = await createContact(db, sponsor, clientId, { fullName: 'Nora NoEmail', email: null });
      const holder = await createContact(db, sponsor, clientId, { fullName: 'Hal Holder' });
      await attempt(sponsor, arrangement.arrangement_id, holder);
      await createContact(db, sponsor, await client(sponsor), { fullName: 'Somebody Else' });

      const choices = await readCoManagedSeatContactChoices(db, { sponsorTenant: sponsor, clientId });
      expect(choices.map((choice) => [choice.contactId, choice.name, choice.blocker])).toEqual([
        [ready, 'Dana Reyes', null], [holder, 'Hal Holder', 'HAS_SEAT'], [inactive, 'Ines Inactive', 'INACTIVE'], [noEmail, 'Nora NoEmail', 'NO_EMAIL'],
      ]);
      expect(await readCoManagedSeatContactChoices(db, { sponsorTenant: sponsor, clientId: 'nope' })).toEqual([]);
    });
  });
});
