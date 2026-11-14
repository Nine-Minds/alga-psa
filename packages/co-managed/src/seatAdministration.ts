import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { getCoManagedEntitlementState, type CoManagedEntitlementState } from '@alga-psa/licensing';
import { CoManagedSeatArrangementError, type CoManagedSeatBoardScopeEntry } from './seatArrangement';
import { coManagedSeatHandoffDefaults, type CoManagedSeatHandoffDefaults } from './seatTicketHandoff';

/**
 * What an MSP administrator sees and changes about seat arrangements: the reads behind the client's
 * Co-managed IT tab and the overview, and the two writes that arrangements had no command for
 * (shared projects and handoff defaults). The writes follow `setCoManagedSeatBoardScope`: declarative,
 * tenant-first, the arrangement row locked, the arrangement revision bumped.
 *
 * Internal commands with no entry point of their own; a caller must authorize sponsor
 * administration and access to the client before using them. Nothing here enforces a rule the
 * arrangement, invitation and allocation commands own; it reads their state and names their refusals.
 */

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Why a client cannot be given a seat arrangement right now: the refusal `createCoManagedSeatArrangement` would give. */
export type CoManagedSeatEnableBlocker =
  | 'SPONSOR_NOT_ELIGIBLE' | 'CLIENT_NOT_FOUND' | 'CLIENT_INACTIVE' | 'CLIENT_HAS_ARRANGEMENT'
  | 'ENTITLEMENT_LAPSED' | 'CAPACITY_UNAVAILABLE';

export interface CoManagedSeatEnableState {
  clientName: string | null;
  /** The pool as the sponsor sees it: purchased, allocated and available seats. */
  capacity: { purchased: number; allocated: number; available: number };
  /** The first reason enabling would be refused, or null when it would not be. */
  blocker: CoManagedSeatEnableBlocker | null;
}

/**
 * The state the shape chooser shows for a client with no seat arrangement: the pool and the
 * refusal enabling would meet, derived from the same facts the commands read (the pool's entitlement,
 * the client record, the client's live arrangement). It writes nothing and the command still decides:
 * the reading can be stale by the time an administrator confirms.
 */
export async function readCoManagedSeatEnableState(
  db: Knex,
  input: { sponsorTenant: string; clientId: string },
): Promise<CoManagedSeatEnableState> {
  const none = { purchased: 0, allocated: 0, available: 0 };
  if (![input.sponsorTenant, input.clientId].every((id) => uuid.test(id))) {
    return { clientName: null, capacity: none, blocker: 'CLIENT_NOT_FOUND' };
  }
  const sponsor = tenantDb(db, input.sponsorTenant);
  const [owner, entitlement, client, seat, named] = await Promise.all([
    sponsor.table('tenants').first('product_code'),
    sponsor.table('co_managed_entitlements').first('tenant'),
    sponsor.table('clients').where('client_id', input.clientId).first('client_name', 'is_inactive'),
    sponsor.table('co_managed_seat_arrangements').where('client_id', input.clientId).whereNot('state', 'ended').first('arrangement_id'),
    // An allocation that names the client. A workspace relationship found only through the customer tenant is
    // the client view's to show, and the command refuses it with the same reason if it is missed here.
    sponsor.table('co_managed_allocations').where('sponsor_client_id', input.clientId).whereNot('state', 'released').first('allocation_id'),
  ]);
  const eligible = Boolean(entitlement) && owner?.product_code === 'psa';
  const pool: CoManagedEntitlementState | null = eligible ? await getCoManagedEntitlementState(db, input.sponsorTenant) : null;
  const capacity = pool ? { purchased: pool.capacity, allocated: pool.allocated, available: pool.available } : none;
  const blocker: CoManagedSeatEnableBlocker | null =
    !eligible ? 'SPONSOR_NOT_ELIGIBLE'
      : !client ? 'CLIENT_NOT_FOUND'
        : seat || named ? 'CLIENT_HAS_ARRANGEMENT'
          : client.is_inactive ? 'CLIENT_INACTIVE'
            : pool && (pool.isReadOnly || pool.graceEndsAt) ? 'ENTITLEMENT_LAPSED'
              : pool && pool.available < 1 ? 'CAPACITY_UNAVAILABLE' : null;
  return { clientName: client?.client_name ?? null, capacity, blocker };
}

export interface CoManagedSeatTechnicianRow {
  assignmentId: string;
  /** The contact this technician is, for a link to the contact; never shown. Null on seats from before contacts were recorded. */
  contactId: string | null;
  state: 'invited' | 'active';
  /** The contact's name when the seat records one, else the invitation's or user's. */
  name: string;
  email: string;
  /** Pending invitations only: when the link stops working. */
  expiresAt: string | null;
  expired: boolean;
}

export interface CoManagedSeatArrangementPanel {
  arrangementId: string;
  clientId: string;
  clientName: string | null;
  allocationId: string;
  state: 'active';
  revision: number;
  seats: number;
  /** Active technicians plus pending invitations: the seats the arrangement has committed. */
  usedSeats: number;
  technicians: CoManagedSeatTechnicianRow[];
  boardScope: CoManagedSeatBoardScopeEntry[];
  sharedProjectIds: string[];
  handoffDefaults: CoManagedSeatHandoffDefaults;
}

/** The client's live seat arrangement as the panel shows it, or null when it has none (an ended one is history, not a panel). */
export async function readCoManagedSeatArrangementPanel(
  db: Knex,
  input: { sponsorTenant: string; clientId: string },
): Promise<CoManagedSeatArrangementPanel | null> {
  if (![input.sponsorTenant, input.clientId].every((id) => uuid.test(id))) return null;
  const sponsor = tenantDb(db, input.sponsorTenant);
  const arrangement = await sponsor.table('co_managed_seat_arrangements')
    .where('client_id', input.clientId).where('state', 'active').first();
  if (!arrangement) return null;
  const [allocation, client, assignments, scope, grants] = await Promise.all([
    sponsor.table('co_managed_allocations').where('allocation_id', arrangement.allocation_id).first('seats'),
    sponsor.table('clients').where('client_id', input.clientId).first('client_name'),
    sponsor.table('co_managed_seat_assignments').where('arrangement_id', arrangement.arrangement_id)
      .whereNot('state', 'revoked').orderBy('created_at').select('assignment_id', 'state', 'invitation_id', 'user_id', 'contact_id'),
    sponsor.table('co_managed_seat_board_scopes').where('arrangement_id', arrangement.arrangement_id)
      .orderBy('board_id').select('board_id', 'can_create'),
    sponsor.table('co_managed_seat_project_grants').where('arrangement_id', arrangement.arrangement_id)
      .orderBy('project_id').select('project_id'),
  ]);
  const invitationIds = assignments.flatMap((row) => row.invitation_id ? [row.invitation_id] : []);
  const userIds = assignments.flatMap((row) => row.user_id ? [row.user_id] : []);
  const contactIds = assignments.flatMap((row) => row.contact_id ? [row.contact_id] : []);
  const [contacts, invitations, users] = await Promise.all([
    contactIds.length ? sponsor.table('contacts').whereIn('contact_name_id', contactIds).select('contact_name_id', 'full_name') : [],
    invitationIds.length ? sponsor.table('user_invitations').whereIn('invitation_id', invitationIds)
      .select('invitation_id', 'email', 'first_name', 'last_name', 'expires_at') : [],
    userIds.length ? sponsor.table('users').whereIn('user_id', userIds).select('user_id', 'email', 'first_name', 'last_name') : [],
  ]);
  const now = Date.now();
  const technicians = assignments.map((row): CoManagedSeatTechnicianRow => {
    const user = users.find((entry) => entry.user_id === row.user_id);
    const invitation = invitations.find((entry) => entry.invitation_id === row.invitation_id);
    const person = row.state === 'active' ? user : invitation;
    const contact = contacts.find((entry) => entry.contact_name_id === row.contact_id);
    const expiresAt = row.state === 'invited' && invitation?.expires_at ? new Date(invitation.expires_at).toISOString() : null;
    return {
      assignmentId: row.assignment_id, contactId: row.contact_id ?? null, state: row.state,
      name: contact?.full_name || [person?.first_name, person?.last_name].filter(Boolean).join(' '),
      email: String(person?.email ?? ''),
      expiresAt, expired: expiresAt !== null && new Date(expiresAt).getTime() <= now,
    };
  });
  return {
    arrangementId: arrangement.arrangement_id, clientId: arrangement.client_id, clientName: client?.client_name ?? null,
    allocationId: arrangement.allocation_id, state: 'active', revision: arrangement.revision,
    seats: Number(allocation?.seats ?? 0), usedSeats: assignments.length, technicians,
    boardScope: scope.map((row) => ({ boardId: row.board_id, canCreate: row.can_create })),
    sharedProjectIds: grants.map((row) => row.project_id),
    handoffDefaults: coManagedSeatHandoffDefaults(arrangement.handoff_defaults),
  };
}

export interface CoManagedSeatAdminOptions {
  boards: Array<{ boardId: string; name: string }>;
  /** The client's own projects, the ones an arrangement can be given. */
  projects: Array<{ projectId: string; name: string }>;
  /** Sponsor staff who can receive a handed-over ticket; seat technicians are not staff. */
  staff: Array<{ userId: string; name: string }>;
}

/** The choices behind the panel's pickers. Names only; the caller never needs to show an id. */
export async function readCoManagedSeatAdminOptions(
  db: Knex,
  input: { sponsorTenant: string; clientId: string },
): Promise<CoManagedSeatAdminOptions> {
  if (![input.sponsorTenant, input.clientId].every((id) => uuid.test(id))) return { boards: [], projects: [], staff: [] };
  const sponsor = tenantDb(db, input.sponsorTenant);
  const [boards, projects, staff, technicians] = await Promise.all([
    sponsor.table('boards').where({ is_inactive: false }).orderBy('board_name').select('board_id', 'board_name'),
    sponsor.table('projects').where({ client_id: input.clientId, is_inactive: false }).orderBy('project_name').select('project_id', 'project_name'),
    sponsor.table('users').where({ user_type: 'internal', is_inactive: false }).orderBy('first_name').orderBy('last_name')
      .select('user_id', 'first_name', 'last_name', 'email'),
    sponsor.table('co_managed_seat_assignments').whereNot('state', 'revoked').whereNotNull('user_id').select('user_id'),
  ]);
  const seatUsers = new Set(technicians.map((row) => row.user_id));
  return {
    boards: boards.map((row) => ({ boardId: row.board_id, name: row.board_name })),
    projects: projects.map((row) => ({ projectId: row.project_id, name: row.project_name })),
    staff: staff.filter((row) => !seatUsers.has(row.user_id)).map((row) => ({
      userId: row.user_id, name: [row.first_name, row.last_name].filter(Boolean).join(' ') || row.email,
    })),
  };
}

/** Why a contact cannot be given a seat right now. */
export type CoManagedSeatContactBlocker = 'INACTIVE' | 'NO_EMAIL' | 'HAS_SEAT';

export interface CoManagedSeatContactChoice {
  contactId: string;
  name: string;
  email: string | null;
  /** Null when the contact can be invited. */
  blocker: CoManagedSeatContactBlocker | null;
}

/**
 * The contacts of a client, each with the first reason it could not be invited. The same facts
 * `inviteCoManagedSeatTechnician` checks, read for the picker: the command still decides, so a
 * stale answer is refused there. Contacts of other clients are never returned.
 */
export async function readCoManagedSeatContactChoices(
  db: Knex,
  input: { sponsorTenant: string; clientId: string },
): Promise<CoManagedSeatContactChoice[]> {
  if (![input.sponsorTenant, input.clientId].every((id) => uuid.test(id))) return [];
  const sponsor = tenantDb(db, input.sponsorTenant);
  const [contacts, holding] = await Promise.all([
    sponsor.table('contacts').where('client_id', input.clientId).orderBy('full_name').select('contact_name_id', 'full_name', 'email', 'is_inactive'),
    sponsor.table('co_managed_seat_assignments').whereNot('state', 'revoked').whereNotNull('contact_id').select('contact_id'),
  ]);
  const held = new Set(holding.map((row) => row.contact_id));
  return contacts.map((row): CoManagedSeatContactChoice => {
    const email = typeof row.email === 'string' && row.email.trim() ? row.email.trim() : null;
    return {
      contactId: row.contact_name_id, name: row.full_name, email,
      blocker: row.is_inactive ? 'INACTIVE' : !email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? 'NO_EMAIL'
        : held.has(row.contact_name_id) ? 'HAS_SEAT' : null,
    };
  });
}

/** One seat arrangement as the overview lists it. */
export interface CoManagedSeatOverviewRow {
  arrangementId: string;
  clientId: string;
  clientName: string | null;
  state: 'active' | 'ended';
  seats: number;
  usedSeats: number;
}

/**
 * Every seat arrangement of the sponsor, live and ended, in client-name order, with the seats it
 * holds and the seats its technicians and pending invitations use. An ended arrangement keeps its
 * row as history and holds no seats. Two queries however many arrangements there are.
 */
export async function readCoManagedSeatOverviewRows(
  db: Knex,
  input: { sponsorTenant: string; search?: string },
): Promise<CoManagedSeatOverviewRow[]> {
  if (!uuid.test(input.sponsorTenant)) return [];
  const sponsor = tenantDb(db, input.sponsorTenant);
  const query = sponsor.table('co_managed_seat_arrangements as a');
  sponsor.tenantJoin(query, 'clients as c', 'c.client_id', 'a.client_id');
  const search = (input.search ?? '').trim();
  if (search) query.whereILike('c.client_name', `%${search.replace(/[\\%_]/g, '\\$&')}%`);
  const arrangements = await query.orderBy('c.client_name').orderBy('a.arrangement_id')
    .select('a.arrangement_id', 'a.client_id', 'a.allocation_id', 'a.state', 'c.client_name');
  if (arrangements.length === 0) return [];
  const [allocations, assignments] = await Promise.all([
    sponsor.table('co_managed_allocations').whereIn('allocation_id', arrangements.map((row) => row.allocation_id)).select('allocation_id', 'seats'),
    sponsor.table('co_managed_seat_assignments').whereIn('arrangement_id', arrangements.map((row) => row.arrangement_id))
      .whereNot('state', 'revoked').groupBy('arrangement_id').select('arrangement_id').count('* as used'),
  ]);
  return arrangements.map((row): CoManagedSeatOverviewRow => {
    const ended = row.state === 'ended';
    return {
      arrangementId: row.arrangement_id, clientId: row.client_id, clientName: row.client_name ?? null, state: row.state,
      seats: ended ? 0 : Number(allocations.find((entry) => entry.allocation_id === row.allocation_id)?.seats ?? 0),
      usedSeats: ended ? 0 : Number(assignments.find((entry) => entry.arrangement_id === row.arrangement_id)?.used ?? 0),
    };
  });
}

export interface CoManagedOverviewEntry {
  shape: 'workspace' | 'seat';
  clientId: string;
  clientName: string | null;
  state: string;
  seats: number;
  usedSeats: number | null;
  /** A workspace row's relationship, so its client link opens that relationship. Seat rows have none. */
  relationshipId: string | null;
  /** Stable key for the row; never shown. */
  key: string;
}

/**
 * One list for both shapes: workspace and seat arrangements sorted by client name (then shape, then key)
 * and cut to the requested page. Pure, so the order is the same wherever the rows came from.
 */
export function mergeCoManagedOverviewEntries(
  entries: readonly CoManagedOverviewEntry[],
  page: { page: number; pageSize: number },
): { rows: CoManagedOverviewEntry[]; totalCount: number } {
  const sorted = [...entries].sort((a, b) =>
    (a.clientName ?? '').localeCompare(b.clientName ?? '') || a.shape.localeCompare(b.shape) || a.key.localeCompare(b.key));
  const start = (page.page - 1) * page.pageSize;
  return { rows: sorted.slice(start, start + page.pageSize), totalCount: sorted.length };
}

async function lockActiveArrangement(trx: Knex.Transaction, sponsorTenant: string, arrangementId: string) {
  const sponsor = tenantDb(trx, sponsorTenant);
  const arrangement = await sponsor.table('co_managed_seat_arrangements')
    .where('arrangement_id', arrangementId).forUpdate().first('state');
  if (!arrangement) throw new CoManagedSeatArrangementError('ARRANGEMENT_NOT_FOUND');
  if (arrangement.state !== 'active') throw new CoManagedSeatArrangementError('ARRANGEMENT_ENDED');
  return sponsor;
}

const bump = (trx: Knex.Transaction) => ({ revision: trx.raw('revision + 1'), updated_at: new Date() });

/**
 * Shares exactly these projects with an arrangement. Declarative, so repeating a request changes
 * nothing. Refuses an arrangement that does not exist or has ended, a project listed twice and a
 * project the sponsor does not have. It writes the grant rows only; what a technician can then do
 * in a shared project belongs to the shared-projects runtime.
 *
 * Locks the arrangement row; it never takes the pool lock.
 */
export async function setCoManagedSeatProjectGrants(
  db: Knex,
  input: { sponsorTenant: string; arrangementId: string; projectIds: readonly string[] },
): Promise<string[]> {
  const projectIds = Array.isArray(input.projectIds) ? [...input.projectIds] : [];
  if (![input.sponsorTenant, input.arrangementId, ...projectIds].every((id) => typeof id === 'string' && uuid.test(id)) ||
      !Array.isArray(input.projectIds) || new Set(projectIds.map((id) => id.toLowerCase())).size !== projectIds.length) {
    throw new CoManagedSeatArrangementError('INVALID_PROJECT_GRANTS');
  }
  return db.transaction(async (trx) => {
    const sponsor = await lockActiveArrangement(trx, input.sponsorTenant, input.arrangementId);
    if (projectIds.length) {
      const projects = await sponsor.table('projects').whereIn('project_id', projectIds).forShare().select('project_id');
      if (projects.length !== projectIds.length) throw new CoManagedSeatArrangementError('PROJECT_NOT_FOUND');
    }
    const grants = () => sponsor.table('co_managed_seat_project_grants').where('arrangement_id', input.arrangementId);
    // write-admission: exempt — seat arrangement lifecycle state, written by its owning command under the arrangement lock
    await grants().whereNotIn('project_id', projectIds).del();
    if (projectIds.length) {
      // write-admission: exempt — seat arrangement lifecycle state, written by its owning command under the arrangement lock
      await sponsor.table('co_managed_seat_project_grants').insert(projectIds.map((projectId) => ({
        tenant: input.sponsorTenant, arrangement_id: input.arrangementId, project_id: projectId,
      }))).onConflict(['tenant', 'arrangement_id', 'project_id']).ignore();
    }
    // write-admission: exempt — seat arrangement lifecycle state, written by its owning command under the arrangement lock
    await sponsor.table('co_managed_seat_arrangements').where('arrangement_id', input.arrangementId).update(bump(trx));
    return (await grants().orderBy('project_id').select('project_id')).map((row) => row.project_id as string);
  });
}

/**
 * Sets what an arrangement applies to a ticket handed to the MSP. Declarative: the whole defaults
 * object is replaced, and `{}` applies nothing. The person named must be an active internal user of
 * the sponsor and not a seat technician. Refuses an arrangement that does not exist or has ended.
 *
 * Locks the arrangement row; it never takes the pool lock.
 */
export async function setCoManagedSeatHandoffDefaults(
  db: Knex,
  input: { sponsorTenant: string; arrangementId: string; defaults: CoManagedSeatHandoffDefaults },
): Promise<CoManagedSeatHandoffDefaults> {
  const assignedTo = input.defaults?.assigned_to;
  if (![input.sponsorTenant, input.arrangementId].every((id) => typeof id === 'string' && uuid.test(id)) ||
      (assignedTo !== undefined && !(typeof assignedTo === 'string' && uuid.test(assignedTo)))) {
    throw new CoManagedSeatArrangementError('INVALID_HANDOFF_DEFAULTS');
  }
  return db.transaction(async (trx) => {
    const sponsor = await lockActiveArrangement(trx, input.sponsorTenant, input.arrangementId);
    if (assignedTo !== undefined) {
      const user = await sponsor.table('users').where({ user_id: assignedTo, user_type: 'internal', is_inactive: false }).forShare().first('user_id');
      const seat = user && await sponsor.table('co_managed_seat_assignments').where('user_id', assignedTo).whereNot('state', 'revoked').first('assignment_id');
      if (!user || seat) throw new CoManagedSeatArrangementError('USER_NOT_FOUND');
    }
    const defaults = coManagedSeatHandoffDefaults(assignedTo === undefined ? {} : { assigned_to: assignedTo });
    // write-admission: exempt — seat arrangement lifecycle state, written by its owning command under the arrangement lock
    await sponsor.table('co_managed_seat_arrangements').where('arrangement_id', input.arrangementId)
      .update({ handoff_defaults: JSON.stringify(defaults), ...bump(trx) });
    return defaults;
  });
}
