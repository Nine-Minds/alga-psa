'use server';

import { withAuth } from '@alga-psa/auth';
import { hasPermission } from '@alga-psa/auth/rbac';
import { createTenantKnex, tenantDb } from '@alga-psa/db';
import { requireCapabilityEitherMode, requireCapabilityForAction } from '@alga-psa/core/capability/server';
import { createClientScopeContext } from '@alga-psa/authorization/clientScopeAuthorization';
import { sendTeamInvitationEmail } from '@alga-psa/email';
import type { Knex } from 'knex';
import { CoManagedAdmissionError, resizeCoManagedSeatAllocation } from '@alga-psa/licensing';
import {
  CoManagedSeatArrangementError, CoManagedSeatInvitationError, coManagedSeatCommitmentCounter,
  createCoManagedSeatArrangement, getCoManagedClientOverview, inviteCoManagedSeatTechnician,
  mergeCoManagedOverviewEntries, readCoManagedSeatAdminOptions, readCoManagedSeatContactChoices, readCoManagedSeatArrangementPanel,
  readCoManagedSeatEnableState, readCoManagedSeatOverviewRows, refreshCoManagedSeatInvitation,
  revokeCoManagedSeatInvitation, setCoManagedSeatBoardScope, setCoManagedSeatHandoffDefaults,
  setCoManagedSeatProjectGrants, type CoManagedOverviewEntry,
  readCoManagedSeatProjectShares, setCoManagedSeatProjectShared,
  endCoManagedSeatArrangement, previewCoManagedSeatArrangementEnd, readCoManagedSeatArrangementClientId,
  readCoManagedSeatTechnicianUsers,
  type CoManagedSeatArrangementEndPreview, type CoManagedSeatArrangementEndResult,
  type CoManagedSeatProjectGrantResult, type CoManagedSeatProjectOption,
} from '@alga-psa/co-managed';
import { admits, serves } from '@alga-psa/core/capability';
import { getCoManagedEntitlementState } from '@alga-psa/licensing';
import { listSimulationTicketOptions } from '@alga-psa/authorization/bundles/simulationTickets';
import { runAuthorizationBundleSimulationAction } from '@enterprise/lib/actions/auth/authorizationBundleActions';
import { coManagedBrowserActor } from '../co-managed/browserActor';
import { admitCoManagedSponsor } from '../co-managed/admitSponsor';

/**
 * Server actions behind the seat shape's administration: the chooser and panel on a client's
 * Co-managed IT tab and the seat rows of the overview. Thin wrappers: each one checks the
 * `co-managed-seat` capability, then that the caller is a sponsor user with the co-managed
 * permission, and then calls the domain command. The rules live in `@alga-psa/co-managed` and
 * `@alga-psa/licensing`.
 *
 * Reading existing state needs `serves`; starting or changing anything needs `admits`, so a served
 * but not admitted sponsor sees a read-only panel. A refusal the screen can name is returned as
 * `{ rejected: true, errorCode }`, because a thrown error reaches the browser as a redacted failure.
 */

const SEAT = 'co-managed-seat' as const;

export type CoManagedSeatRejection = { rejected: true; errorCode: string };
const refused = (error: unknown): CoManagedSeatRejection => {
  if (error instanceof CoManagedSeatArrangementError || error instanceof CoManagedSeatInvitationError ||
      error instanceof CoManagedAdmissionError) return { rejected: true, errorCode: error.code };
  throw error;
};

type SeatUser = { user_id: string; user_type?: string; first_name?: string | null; last_name?: string | null; username?: string };

async function readCanManage(user: SeatUser) {
  return hasPermission(user as never, 'co_management', 'manage');
}

/** What the client tab needs to choose between the chooser, the panel and nothing. */
export const getCoManagedSeatClientState = withAuth(async (user, { tenant }, clientId: string) => {
  const held = await requireCapabilityEitherMode(SEAT, tenant);
  const knex = await authorizeSeatAdministration(user, tenant, held, 'read', { clientId });
  const canManage = await readCanManage(user);
  const panel = await readCoManagedSeatArrangementPanel(knex, { sponsorTenant: tenant, clientId });
  // Starting an arrangement needs `admits`; a served-only sponsor is shown existing state and no chooser.
  const admitted = (await admits(SEAT, tenant)).admitted;
  const enable = !panel && admitted && canManage ? await readCoManagedSeatEnableState(knex, { sponsorTenant: tenant, clientId }) : null;
  return { panel, enable, canManage: canManage && admitted };
});

/** The choices behind the panel's and chooser's pickers. */
export const getCoManagedSeatAdminOptions = withAuth(async (user, { tenant }, clientId: string) => {
  await requireCapabilityForAction(SEAT, tenant, 'admits');
  const knex = await authorizeSeatAdministration(user, tenant, 'admits', 'manage', { clientId });
  return readCoManagedSeatAdminOptions(knex, { sponsorTenant: tenant, clientId });
});

/**
 * The client's contacts for the technician picker, each with the reason it cannot be invited (inactive,
 * no email, already holds a seat or pending invitation) or null. Computed here from the same facts the
 * invite command checks; the screen only shows it. The command re-checks, so a stale answer is refused there.
 */
export const getCoManagedSeatContactChoicesAction = withAuth(async (user, { tenant }, clientId: string) => {
  await requireCapabilityForAction(SEAT, tenant, 'admits');
  const knex = await authorizeSeatAdministration(user, tenant, 'admits', 'manage', { clientId });
  return readCoManagedSeatContactChoices(knex, { sponsorTenant: tenant, clientId });
});

export interface EnableCoManagedSeatInput {
  clientId: string;
  /** The idempotency key: a repeated submit returns the same arrangement. */
  operationId: string;
  seats: number;
  boards: Array<{ boardId: string; canCreate: boolean }>;
  /** The first technician: a contact of the client. Name and email come from the contact row. */
  contactId: string;
}

type Delivery = { delivered: boolean };

/**
 * Enables the seat shape for a client: the arrangement (which reserves and activates the allocation),
 * then its board scope, then the first technician's invitation. Replaying the same operation returns
 * the same arrangement. Once the arrangement exists the result says so, whatever happened after it,
 * so the screen moves to the panel where the remaining steps can be finished.
 */
export const enableCoManagedSeatArrangementAction = withAuth(async (user, { tenant }, input: EnableCoManagedSeatInput) => {
  await requireCapabilityForAction(SEAT, tenant, 'admits');
  const knex = await authorizeSeatAdministration(user, tenant, 'admits', 'manage', { clientId: input.clientId });
  let arrangementId: string;
  try {
    arrangementId = (await createCoManagedSeatArrangement(knex, {
      sponsorTenant: tenant, clientId: input.clientId, operationId: input.operationId, seats: input.seats,
    })).arrangement_id;
  } catch (error) { return refused(error); }

  const result = { created: true as const, scopeSet: false, invited: false, delivered: false, followUpError: null as string | null };
  try {
    await setCoManagedSeatBoardScope(knex, {
      sponsorTenant: tenant, arrangementId,
      boards: (input.boards ?? []).map((board) => ({ boardId: board.boardId, canCreate: board.canCreate === true })),
    });
    result.scopeSet = true;
  } catch (error) { result.followUpError = refused(error).errorCode; return result; }
  try {
    const invitation = await inviteCoManagedSeatTechnician(knex, {
      sponsorTenant: tenant, arrangementId, contactId: input.contactId, invitedBy: user.user_id,
    });
    result.invited = true;
    if (invitation.created) result.delivered = (await deliverSeatInvitation(user, tenant, invitation)).delivered;
    else result.delivered = true;
  } catch (error) { result.followUpError = refused(error).errorCode; }
  return result;
});

/** Changes the arrangement's allocation. `expectedSeats` is the size the screen last showed. */
export const changeCoManagedSeatAllocationAction = withAuth(async (user, { tenant }, input: {
  arrangementId: string; seats: number; expectedSeats: number;
}) => {
  await requireCapabilityForAction(SEAT, tenant, 'admits');
  const knex = await authorizeSeatAdministration(user, tenant, 'admits', 'manage', { arrangementId: input.arrangementId });
  try {
    const arrangement = await tenantDb(knex, tenant).table('co_managed_seat_arrangements')
      .where({ arrangement_id: input.arrangementId, state: 'active' }).first('allocation_id');
    if (!arrangement) throw new CoManagedSeatArrangementError('ARRANGEMENT_NOT_FOUND');
    await resizeCoManagedSeatAllocation(knex, tenant, {
      allocationId: arrangement.allocation_id, seats: input.seats, expectedSeats: input.expectedSeats,
      countCommittedSeats: coManagedSeatCommitmentCounter(tenant),
    });
    return { changed: true as const };
  } catch (error) { return refused(error); }
});

export const setCoManagedSeatBoardScopeAction = withAuth(async (user, { tenant }, input: {
  arrangementId: string; boards: Array<{ boardId: string; canCreate: boolean }>;
}) => {
  await requireCapabilityForAction(SEAT, tenant, 'admits');
  const knex = await authorizeSeatAdministration(user, tenant, 'admits', 'manage', { arrangementId: input.arrangementId });
  try { return { changed: true as const, boards: await setCoManagedSeatBoardScope(knex, { sponsorTenant: tenant, ...input }) }; }
  catch (error) { return refused(error); }
});

export const setCoManagedSeatProjectGrantsAction = withAuth(async (user, { tenant }, input: {
  arrangementId: string; projectIds: string[];
}) => {
  await requireCapabilityForAction(SEAT, tenant, 'admits');
  const knex = await authorizeSeatAdministration(user, tenant, 'admits', 'manage', { arrangementId: input.arrangementId });
  try { return { changed: true as const, projectIds: await setCoManagedSeatProjectGrants(knex, { sponsorTenant: tenant, ...input }) }; }
  catch (error) { return refused(error); }
});

export const setCoManagedSeatHandoffDefaultsAction = withAuth(async (user, { tenant }, input: {
  arrangementId: string; assignedTo: string | null;
}) => {
  await requireCapabilityForAction(SEAT, tenant, 'admits');
  const knex = await authorizeSeatAdministration(user, tenant, 'admits', 'manage', { arrangementId: input.arrangementId });
  try {
    const defaults = await setCoManagedSeatHandoffDefaults(knex, {
      sponsorTenant: tenant, arrangementId: input.arrangementId, defaults: input.assignedTo ? { assigned_to: input.assignedTo } : {},
    });
    return { changed: true as const, defaults };
  } catch (error) { return refused(error); }
});

/** Invites another technician, chosen from the arrangement's client's contacts, into an existing arrangement. */
export const inviteCoManagedSeatTechnicianAction = withAuth(async (user, { tenant }, input: {
  arrangementId: string; contactId: string;
}) => {
  await requireCapabilityForAction(SEAT, tenant, 'admits');
  const knex = await authorizeSeatAdministration(user, tenant, 'admits', 'manage', { arrangementId: input.arrangementId });
  try {
    const invitation = await inviteCoManagedSeatTechnician(knex, {
      sponsorTenant: tenant, arrangementId: input.arrangementId, contactId: input.contactId, invitedBy: user.user_id,
    });
    const delivery = invitation.created ? await deliverSeatInvitation(user, tenant, invitation) : { delivered: true };
    return { invited: true as const, delivered: delivery.delivered };
  } catch (error) { return refused(error); }
});

/** Sends a pending invitation again, with a new link. */
export const resendCoManagedSeatInvitationAction = withAuth(async (user, { tenant }, input: { assignmentId: string }) => {
  await requireCapabilityForAction(SEAT, tenant, 'admits');
  const knex = await authorizeSeatAdministration(user, tenant, 'admits', 'manage', { assignmentId: input.assignmentId });
  try {
    const refreshed = await refreshCoManagedSeatInvitation(knex, { sponsorTenant: tenant, assignmentId: input.assignmentId });
    return { resent: true as const, ...(await deliverSeatInvitation(user, tenant, refreshed)) };
  } catch (error) { return refused(error); }
});

/** Withdraws a pending invitation and frees its seat. Accepted technicians are not revoked here. */
export const revokeCoManagedSeatInvitationAction = withAuth(async (user, { tenant }, input: { assignmentId: string }) => {
  await requireCapabilityForAction(SEAT, tenant, 'admits');
  const knex = await authorizeSeatAdministration(user, tenant, 'admits', 'manage', { assignmentId: input.assignmentId });
  try { return { ...(await revokeCoManagedSeatInvitation(knex, { sponsorTenant: tenant, assignmentId: input.assignmentId })) }; }
  catch (error) { return refused(error); }
});

export interface CoManagedOverviewPage {
  rows: CoManagedOverviewEntry[];
  totalCount: number;
  pool: { purchased: number; allocated: number; available: number };
}

const WORKSPACE_PAGE = 100;

/**
 * The overview with both shapes in one list and the pool's totals. Only for a sponsor served by
 * `co-managed-seat`: any other tenant keeps the workspace-only action and runs no seat query.
 * The workspace reader pages at 100, so its pages are read through before the merge.
 */
// LEVERAGE: pattern overview-merge-paging — a cross-shape list has to read the workspace overview to exhaustion because that reader only offsets within itself; a shared arrangements read would page both shapes in one query.
export const getCoManagedCombinedOverviewAction = withAuth(async (user, { tenant }, input: {
  search?: string; page?: number; pageSize?: number;
} = {}): Promise<CoManagedOverviewPage> => {
  const held = await requireCapabilityEitherMode(SEAT, tenant);
  const knex = await authorizeSeatAdministration(user, tenant, held, 'read', null);
  const page = input.page ?? 1, pageSize = input.pageSize ?? 20;
  if (!Number.isSafeInteger(page) || page < 1 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) throw new Error('Invalid request');
  const clientScope = await createClientScopeContext(knex, tenant, user as never);
  const seatRows: Awaited<ReturnType<typeof readCoManagedSeatOverviewRows>> = [];
  for (const row of await readCoManagedSeatOverviewRows(knex, { sponsorTenant: tenant, search: input.search })) {
    if (await clientScope.permits('client', row.clientId)) seatRows.push(row);
  }
  const entries: CoManagedOverviewEntry[] = seatRows
    .map((row) => ({
      shape: 'seat' as const, clientId: row.clientId, clientName: row.clientName,
      state: row.state, seats: row.seats, usedSeats: row.state === 'ended' ? null : row.usedSeats, relationshipId: null, key: row.arrangementId,
    }));
  if ((await admits('co-managed', tenant)).admitted || (await serves('co-managed', tenant)).served) {
    const actor = await coManagedBrowserActor(user, tenant);
    for (let next = 1; ; next += 1) {
      const workspace = await getCoManagedClientOverview(knex, actor, { search: input.search, page: next, pageSize: WORKSPACE_PAGE });
      for (const row of workspace.rows) {
        entries.push({
          shape: 'workspace', clientId: row.clientId, clientName: row.clientName,
          state: row.state, seats: row.seats, usedSeats: row.usedSeats, relationshipId: row.relationshipId, key: row.operationId,
        });
      }
      if (next * WORKSPACE_PAGE >= workspace.totalCount) break;
    }
  }
  const pool = await getCoManagedEntitlementState(knex, tenant);
  return {
    ...mergeCoManagedOverviewEntries(entries, { page, pageSize }),
    pool: { purchased: pool.capacity, allocated: pool.allocated, available: pool.available },
  };
});

export interface CoManagedSeatTechnicianListing {
  userId: string;
  /** The client the seat is for. Null when that client is outside the administrator's client scope: the name is not shown. */
  clientName: string | null;
  state: 'invited' | 'active';
}

/**
 * The users of this MSP who hold a live seat, each with the name of their client. User administration lists
 * these apart from MSP staff. Read-only: needs the capability to serve, and the permission to read users.
 */
export const listCoManagedSeatTechniciansAction = withAuth(async (user, { tenant }): Promise<CoManagedSeatTechnicianListing[]> => {
  await requireCapabilityEitherMode(SEAT, tenant);
  const knex = await authorizeUserAdministration(user, tenant);
  const [technicians, scope] = await Promise.all([
    readCoManagedSeatTechnicianUsers(knex, { sponsorTenant: tenant }),
    createClientScopeContext(knex, tenant, user as never),
  ]);
  return Promise.all(technicians.map(async (row): Promise<CoManagedSeatTechnicianListing> => ({
    userId: row.userId,
    clientName: row.clientId && await scope.permits('client', row.clientId) ? row.clientName : null,
    state: row.state,
  })));
});

/** Recent tickets for the effective-access picker, by number and title. Never the ticket id. */
export const searchCoManagedSeatAccessTicketsAction = withAuth(async (user, { tenant }, input: { search?: string }) => {
  await requireCapabilityEitherMode(SEAT, tenant);
  const knex = await authorizeUserAdministration(user, tenant);
  // The shared reader behind the simulator's record list, without the simulator's bundle-tier gate: effective
  // access is not a bundle feature.
  return listSimulationTicketOptions(knex, tenant, input?.search);
});

/**
 * Whether a seat technician may read a ticket, and why not. The decision is the authorization simulator's, run
 * through the real kernel (including the seat resolver), with no bundle: this is what the technician gets today.
 * The user must hold a live seat; this is not a way to simulate anyone else.
 */
export const explainCoManagedSeatTicketAccessAction = withAuth(async (user, { tenant }, input: { userId: string; ticketId: string }) => {
  await requireCapabilityEitherMode(SEAT, tenant);
  const knex = await authorizeUserAdministration(user, tenant);
  const technicians = await readCoManagedSeatTechnicianUsers(knex, { sponsorTenant: tenant });
  if (!technicians.some((row) => row.userId === input.userId)) throw new Error('Permission denied');
  const result = await runAuthorizationBundleSimulationAction({
    principalUserId: input.userId, resourceType: 'ticket', action: 'read', resourceId: input.ticketId,
  });
  // A refusal the simulator names (or CE, which has no simulator) comes back as a code; the screen words it.
  if (result.ok === false) return { ok: false as const, code: result.error.code };
  const { allowed, explanations } = result.data.published;
  return { ok: true as const, allowed, explanations };
});

// Helpers sit below the actions on purpose: each action calls its capability adapter before any of this touches the database.

/**
 * The caller must be a sponsor user holding the co-managed permission and able to read the client.
 * Every action takes the capability adapter itself, first and from the session tenant, and passes the
 * mode that held: a read is open to an admitted sponsor with nothing yet (the chooser needs it) and to a
 * served one whose pool has since closed (its arrangements stay readable); starting or changing needs `admits`.
 */
async function authorizeSeatAdministration(
  user: SeatUser, tenant: string, held: 'serves' | 'admits', permission: 'read' | 'manage', target: SeatTarget | null,
) {
  if (user.user_type !== 'internal') throw new Error('Permission denied');
  if (held === 'admits') await admitCoManagedSponsor(tenant);
  if (!await hasPermission(user as never, 'co_management', permission) || !await hasPermission(user as never, 'client', 'read')) {
    throw new Error('Permission denied');
  }
  // Seat administration is a browser flow; an API key override cannot lend its authority to it.
  await coManagedBrowserActor(user, tenant);
  const { knex } = await createTenantKnex(tenant);
  // The client must be inside the administrator's own client scope. A target that names nothing is left to
  // the command, which refuses it as not found; that reveals nothing.
  const clientId = target ? await clientOfTarget(knex, tenant, target) : null;
  if (clientId && !await (await createClientScopeContext(knex, tenant, user as never)).permits('client', clientId)) {
    throw new Error('Permission denied');
  }
  return knex;
}

/** The caller must be an internal user who may read users: the permission user administration itself needs. */
async function authorizeUserAdministration(user: SeatUser, tenant: string) {
  if (user.user_type !== 'internal' || !await hasPermission(user as never, 'user', 'read')) throw new Error('Permission denied');
  await coManagedBrowserActor(user, tenant);
  const { knex } = await createTenantKnex(tenant);
  return knex;
}

type SeatTarget = { clientId: string } | { arrangementId: string } | { assignmentId: string };

async function clientOfTarget(knex: Knex, tenant: string, target: SeatTarget): Promise<string | null> {
  if ('clientId' in target) return typeof target.clientId === 'string' ? target.clientId : null;
  const scoped = tenantDb(knex, tenant);
  const arrangementId = 'arrangementId' in target ? target.arrangementId : (await scoped.table('co_managed_seat_assignments')
    .where('assignment_id', target.assignmentId).first('arrangement_id'))?.arrangement_id;
  if (typeof arrangementId !== 'string') return null;
  return (await scoped.table('co_managed_seat_arrangements').where('arrangement_id', arrangementId).first('client_id'))?.client_id ?? null;
}

/**
 * Sends the setup link of a seat invitation. After the command committed: the seat is held whether or
 * not the email goes, and a failed send is reported so the administrator can resend.
 */
// LEVERAGE: pattern team-invitation-delivery — base URL, MSP name lookup and sendTeamInvitationEmail repeat what sendUserInvitation does in @alga-psa/users; a shared "deliver an internal-user invitation" function would serve both, and the link opens /auth/team/setup, whose completion hands a seat token to acceptCoManagedSeatInvitation.
async function deliverSeatInvitation(user: SeatUser, tenant: string, invitation: {
  email: string; firstName: string; lastName: string; token: string;
}): Promise<Delivery> {
  try {
    const base = process.env.NEXT_PUBLIC_BASE_URL || process.env.NEXTAUTH_URL || (process.env.HOST ? `https://${process.env.HOST}` : '');
    if (!base) return { delivered: false };
    const { knex } = await createTenantKnex(tenant);
    // The MSP's name in the email is a courtesy: not finding it never stops the invitation going out.
    const owner = await (async () => {
      try {
        const scoped = tenantDb(knex, tenant);
        const defaultClient = scoped.table('tenant_companies').where({ 'tenant_companies.is_default': true }).select('clients.client_name').first();
        scoped.tenantJoin(defaultClient, 'clients', 'clients.client_id', 'tenant_companies.client_id');
        return await defaultClient as { client_name: string } | undefined;
      } catch { return undefined; }
    })();
    const link = new URL('/auth/team/setup', base.endsWith('/') ? base : `${base}/`);
    link.searchParams.set('token', invitation.token);
    const sent = await sendTeamInvitationEmail({
      email: invitation.email, teamMemberName: `${invitation.firstName} ${invitation.lastName}`.trim(),
      tenantName: owner?.client_name || 'your team', roleName: 'Seat Technician',
      invitedByName: `${user.first_name || ''} ${user.last_name || ''}`.trim() || user.username || '',
      inviteLink: link.toString(), expirationTime: '24 hours', tenant,
    });
    return { delivered: sent !== false };
  } catch (error) {
    console.error('Seat invitation delivery failed:', error);
    return { delivered: false };
  }
}

// Every seat surface resolves the `co-managed-seat` capability, never the raw release flag. Ending
// an arrangement is a management action, so it gates on `admits` (flag and eligibility): with the
// flag off nothing here is reachable, whether or not an arrangement exists.

export type CoManagedSeatEndPreviewResult =
  | { ok: true; preview: CoManagedSeatArrangementEndPreview }
  | { ok: false; reason: 'denied' | 'not_found' };

export type CoManagedSeatEndResult =
  | { ok: true; result: CoManagedSeatArrangementEndResult }
  | { ok: false; reason: 'denied' | 'not_found' };

const mayManage = async (user: Parameters<typeof hasPermission>[0]) =>
  user.user_type === 'internal' && await hasPermission(user, 'co_management', 'manage');

/**
 * An arrangement belongs to one client: the preview names it and ending hands that client's tickets back.
 * An administrator whose client scope does not include it gets the same answer as for a missing
 * arrangement, so neither the client nor the arrangement's existence leaks.
 */
const arrangementInClientScope = async (db: Knex, tenant: string, user: Parameters<typeof createClientScopeContext>[2], arrangementId: string) => {
  const clientId = await readCoManagedSeatArrangementClientId(db, { sponsorTenant: tenant, arrangementId });
  return clientId !== null && (await createClientScopeContext(db, tenant, user)).permits('client', clientId);
};

/** The effects of ending an arrangement, for the confirmation. Reads only. */
export const getCoManagedSeatArrangementEndPreview = withAuth(async (user, { tenant },
  input: { arrangementId: string }): Promise<CoManagedSeatEndPreviewResult> => {
  await requireCapabilityForAction('co-managed-seat', tenant, 'admits');
  if (!await mayManage(user)) return { ok: false, reason: 'denied' };
  const { knex } = await createTenantKnex(tenant);
  if (!await arrangementInClientScope(knex, tenant, user, input.arrangementId)) {
    return { ok: false, reason: 'not_found' };
  }
  try {
    return { ok: true, preview: await previewCoManagedSeatArrangementEnd(knex, { sponsorTenant: tenant, arrangementId: input.arrangementId }) };
  } catch (error) {
    if (error instanceof CoManagedSeatArrangementError && error.code === 'ARRANGEMENT_NOT_FOUND') return { ok: false, reason: 'not_found' };
    throw error;
  }
});

/** Ends the arrangement. Replaying it after it completed changes nothing and succeeds. */
export const endCoManagedSeatArrangementAction = withAuth(async (user, { tenant },
  input: { arrangementId: string }): Promise<CoManagedSeatEndResult> => {
  await requireCapabilityForAction('co-managed-seat', tenant, 'admits');
  if (!await mayManage(user)) return { ok: false, reason: 'denied' };
  const { knex } = await createTenantKnex(tenant);
  if (!await arrangementInClientScope(knex, tenant, user, input.arrangementId)) {
    return { ok: false, reason: 'not_found' };
  }
  try {
    return { ok: true, result: await endCoManagedSeatArrangement(knex, {
      sponsorTenant: tenant, arrangementId: input.arrangementId, actorUserId: user.user_id }) };
  } catch (error) {
    if (error instanceof CoManagedSeatArrangementError && error.code === 'ARRANGEMENT_NOT_FOUND') return { ok: false, reason: 'not_found' };
    throw error;
  }
});

// ---------------------------------------------------------------------------------------------------------------
// Shared projects (S29). The administrator chooses which of the arrangement's client's projects its technicians see.
// Same gates as ending an arrangement: the `co-managed-seat` capability (flag and eligibility), the `co_management`
// manage permission, and the arrangement's client inside the administrator's client scope.
// ---------------------------------------------------------------------------------------------------------------

export type CoManagedSeatSharedProjectsResult =
  | { ok: true; projects: CoManagedSeatProjectOption[] }
  | { ok: false; reason: 'denied' | 'not_found' };

export type CoManagedSeatProjectShareResult =
  | { ok: true; result: CoManagedSeatProjectGrantResult }
  | { ok: false; reason: 'denied' | 'not_found' | 'project_not_found' };

/** The arrangement's client's projects, each with whether it is shared with the arrangement. Reads only. */
export const getCoManagedSeatSharedProjects = withAuth(async (user, { tenant },
  input: { arrangementId: string }): Promise<CoManagedSeatSharedProjectsResult> => {
  await requireCapabilityForAction('co-managed-seat', tenant, 'admits');
  if (!await mayManage(user)) return { ok: false, reason: 'denied' };
  const { knex } = await createTenantKnex(tenant);
  if (!await arrangementInClientScope(knex, tenant, user, input.arrangementId)) return { ok: false, reason: 'not_found' };
  return { ok: true, projects: await readCoManagedSeatProjectShares(knex, { sponsorTenant: tenant, arrangementId: input.arrangementId }) };
});

/**
 * Shares one project with the arrangement, or stops sharing it. Repeating a request changes nothing and succeeds.
 * A technician's access follows on their next request; nothing is cached.
 */
export const setCoManagedSeatProjectSharedAction = withAuth(async (user, { tenant },
  input: { arrangementId: string; projectId: string; shared: boolean }): Promise<CoManagedSeatProjectShareResult> => {
  await requireCapabilityForAction('co-managed-seat', tenant, 'admits');
  if (!await mayManage(user)) return { ok: false, reason: 'denied' };
  const { knex } = await createTenantKnex(tenant);
  if (!await arrangementInClientScope(knex, tenant, user, input.arrangementId)) return { ok: false, reason: 'not_found' };
  try {
    return { ok: true, result: await setCoManagedSeatProjectShared(knex, {
      sponsorTenant: tenant, arrangementId: input.arrangementId, projectId: input.projectId, shared: input.shared }) };
  } catch (error) {
    if (error instanceof CoManagedSeatArrangementError) {
      if (error.code === 'ARRANGEMENT_NOT_FOUND' || error.code === 'ARRANGEMENT_ENDED') return { ok: false, reason: 'not_found' };
      if (error.code === 'PROJECT_NOT_FOUND' || error.code === 'INVALID_PROJECT_GRANT') return { ok: false, reason: 'project_not_found' };
    }
    throw error;
  }
});
