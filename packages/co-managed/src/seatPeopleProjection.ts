/**
 * The people a seat technician can see: one projection for every user list, picker and mention source.
 *
 * An internal user of the sponsor tenant can normally list every user of the tenant. A seat technician
 * sees exactly three kinds of person, derived from their seat scope and nothing else:
 *
 * - `msp_staff`: MSP staff who PARTICIPATE on a ticket the technician can see. "Can see" is the seat
 *   policy's own ticket read rule (`SEAT_AUTHORITY_POLICY.ticket.read`): the ticket belongs to the
 *   technician's client and sits on a board in scope. Participant means the ticket's assignee
 *   (`tickets.assigned_to`) or an additional agent (`ticket_resources.additional_user_id`). Comment
 *   authors are deliberately not counted: whether an author is visible depends on the comment's audience,
 *   and the people list must not be a second reader of conversations. Released fields: name only (the
 *   avatar is keyed by `userId`).
 * - `client_technician`: users holding a live seat assignment on the technician's own arrangement
 *   (themselves included, so they can assign work to themselves).
 * - `contact`: active contacts of the technician's client, with the client's portal user when one is
 *   linked to the contact.
 *
 * Nobody else appears: MSP staff with no participation, technicians of other clients, other clients'
 * contacts, inactive users and non-interactive principals. A seat subject with no scope (revoked, lapsed,
 * ended) sees nobody; it never falls back to an unfiltered list.
 *
 * Each kind releases only the fields of its mask (`SEAT_PEOPLE_FIELD_MASK`). The mask is applied where
 * the columns are selected, so a withheld column is never read, and again on the result
 * (`maskSeatPerson`) so a source that over-reads still cannot release it. Every surface maps from the
 * masked `ProjectedPerson`; none of them reads the `users` table on its own for a seat subject.
 *
 * Registration is a side effect of importing this module; `./capability`, which every process boots
 * through, imports it. The user actions reach it through the authorization package's projector registry,
 * so they need no dependency on this package.
 */
import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import {
  registerSubjectPeopleProjector,
  type PeopleProjectionQuery,
  type ProjectedPerson,
  type ProjectedPersonField,
  type ProjectedPersonKind,
  type SubjectPeopleProjector,
} from '@alga-psa/authorization/subject/peopleProjection';
import { CO_MANAGED_SEAT_RESOLVER_ID, coManagedSeatAuthority, isCoManagedSeatSubject, type CoManagedSeatScope } from './seatAuthority';

export type { ProjectedPerson, ProjectedPersonField, ProjectedPersonKind };

/** What each kind of person releases to a seat technician. MSP staff release a name and nothing else. */
export const SEAT_PEOPLE_FIELD_MASK: Readonly<Record<ProjectedPersonKind, readonly ProjectedPersonField[]>> = Object.freeze({
  msp_staff: Object.freeze(['displayName', 'firstName', 'lastName'] as const),
  client_technician: Object.freeze(['displayName', 'firstName', 'lastName', 'username', 'email'] as const),
  contact: Object.freeze(['displayName', 'firstName', 'lastName', 'email'] as const),
});

/** A person reduced to its kind's mask. Reference ids and `kind` always survive; every other field must be in the mask. */
export function maskSeatPerson(
  kind: ProjectedPersonKind,
  raw: Partial<Record<ProjectedPersonField, string | null>> & { userId?: string | null; contactId?: string | null; clientId?: string | null },
  mask: Readonly<Record<ProjectedPersonKind, readonly ProjectedPersonField[]>> = SEAT_PEOPLE_FIELD_MASK,
): ProjectedPerson {
  const person: ProjectedPerson = { kind, userId: raw.userId ?? null, contactId: kind === 'contact' ? raw.contactId ?? null : null, displayName: '' };
  if (kind === 'contact') person.clientId = raw.clientId ?? null;
  for (const field of mask[kind]) {
    const value = raw[field];
    if (value !== undefined) (person as unknown as Record<string, unknown>)[field] = value;
  }
  person.displayName = typeof person.displayName === 'string' ? person.displayName.trim() : '';
  return person;
}

type Db = Knex | Knex.Transaction;

const displayNameOfUser = (db: Db) => db.raw("btrim(concat(coalesce(u.first_name, ''), ' ', coalesce(u.last_name, '')))");

/** Select list of a kind's released user columns, and nothing else. */
function userColumns(db: Db, kind: ProjectedPersonKind): Array<string | Knex.Raw> {
  const columns: Array<string | Knex.Raw> = ['u.user_id as userId'];
  const column: Record<ProjectedPersonField, () => string | Knex.Raw | null> = {
    displayName: () => db.raw('? as "displayName"', [displayNameOfUser(db)]),
    firstName: () => 'u.first_name as firstName',
    lastName: () => 'u.last_name as lastName',
    username: () => 'u.username as username',
    email: () => 'u.email as email',
    phone: () => 'u.phone as phone',
  };
  for (const field of SEAT_PEOPLE_FIELD_MASK[kind]) {
    const selected = column[field]();
    if (selected) columns.push(selected);
  }
  return columns;
}

const matches = (db: Db, query: Knex.QueryBuilder, search: string | undefined, nameSql: string) => {
  const term = search?.trim().toLowerCase();
  if (!term) return query;
  const pattern = `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  return query.whereRaw(`lower(${nameSql}) like ?`, [pattern]);
};

const USER_NAME_SQL = "concat(coalesce(u.first_name, ''), ' ', coalesce(u.last_name, ''))";

/** MSP staff on the tickets the technician can see: the same client and board conditions as `SEAT_AUTHORITY_POLICY.ticket.read`. */
async function mspStaff(db: Db, tenant: string, scope: CoManagedSeatScope, query: PeopleProjectionQuery) {
  if (scope.boardIds.length === 0) return [];
  const scoped = tenantDb(db, tenant);
  const visibleTickets = () => scoped.table('tickets as t').where('t.client_id', scope.clientId).whereIn('t.board_id', scope.boardIds);

  const assignees = visibleTickets().whereNotNull('t.assigned_to').select('t.assigned_to');
  const additionalAgents = visibleTickets().select('t.ticket_id');
  const agentRows = scoped.table('ticket_resources as tr').whereNotNull('tr.additional_user_id')
    .whereIn('tr.ticket_id', additionalAgents).select('tr.additional_user_id');

  const people = scoped.table('users as u')
    .where('u.user_type', 'internal').where('u.is_inactive', false)
    .where((participants) => participants.whereIn('u.user_id', assignees).orWhereIn('u.user_id', agentRows))
    // A seat technician is never MSP staff, whatever tickets they hold.
    .whereNotExists(scoped.table('authorization_resolver_subjects as m')
      .whereRaw('m.user_id = u.user_id').where('m.resolver_id', CO_MANAGED_SEAT_RESOLVER_ID).select(db.raw('1')))
    .select(userColumns(db, 'msp_staff'))
    .orderBy('u.first_name').orderBy('u.last_name').orderBy('u.user_id');
  return matches(db, people, query.search, USER_NAME_SQL).limit(query.limit ?? 1000);
}

async function clientTechnicians(db: Db, tenant: string, scope: CoManagedSeatScope, query: PeopleProjectionQuery) {
  const scoped = tenantDb(db, tenant);
  const people = scoped.table('users as u');
  scoped.tenantJoin(people, 'co_managed_seat_assignments as a', 'a.user_id', 'u.user_id');
  people.where('a.arrangement_id', scope.arrangementId).where('a.state', 'active')
    .where('u.user_type', 'internal').where('u.is_inactive', false)
    .select(userColumns(db, 'client_technician'))
    .orderBy('u.first_name').orderBy('u.last_name').orderBy('u.user_id');
  return matches(db, people, query.search, `${USER_NAME_SQL} || ' ' || coalesce(u.username, '')`).limit(query.limit ?? 1000);
}

async function contacts(db: Db, tenant: string, scope: CoManagedSeatScope, query: PeopleProjectionQuery) {
  const scoped = tenantDb(db, tenant);
  const people = scoped.table('contacts as c');
  // The client's portal user, when the contact has an active one.
  scoped.tenantJoin(people, 'users as u', 'u.contact_id', 'c.contact_name_id', { type: 'left' });
  people.where('c.client_id', scope.clientId)
    .where((active) => active.where('c.is_inactive', false).orWhereNull('c.is_inactive'))
    .where((portal) => portal.whereNull('u.user_id').orWhere((linked) => linked.where('u.user_type', 'client').where('u.is_inactive', false)));
  const columns: Array<string | Knex.Raw> = ['c.contact_name_id as contactId', 'c.client_id as clientId', 'u.user_id as userId'];
  const released = new Set(SEAT_PEOPLE_FIELD_MASK.contact);
  if (released.has('displayName')) columns.push('c.full_name as displayName');
  if (released.has('firstName')) columns.push('u.first_name as firstName');
  if (released.has('lastName')) columns.push('u.last_name as lastName');
  if (released.has('email')) columns.push('c.email as email');
  people.select(columns).orderBy('c.full_name').orderBy('c.contact_name_id');
  return matches(db, people, query.search, "coalesce(c.full_name, '')").limit(query.limit ?? 1000);
}

/**
 * The people of one seat scope, masked per kind. Pure of the subject: callers that already hold a scope
 * use this; the registered projector below resolves the scope from the subject first.
 */
export async function projectSeatPeople(
  db: Db,
  tenant: string,
  scope: CoManagedSeatScope | null,
  query: PeopleProjectionQuery = {},
): Promise<ProjectedPerson[]> {
  if (!scope) return [];
  const wanted = (kind: ProjectedPersonKind) => !query.kinds || query.kinds.includes(kind);
  const [staff, technicians, clientContacts] = await Promise.all([
    wanted('msp_staff') ? mspStaff(db, tenant, scope, query) : [],
    wanted('client_technician') ? clientTechnicians(db, tenant, scope, query) : [],
    wanted('contact') ? contacts(db, tenant, scope, query) : [],
  ]);
  const people = [
    ...(staff as Array<Record<string, string | null>>).map((row) => maskSeatPerson('msp_staff', row)),
    ...(technicians as Array<Record<string, string | null>>).map((row) => maskSeatPerson('client_technician', row)),
    ...(clientContacts as Array<Record<string, string | null>>).map((row) => maskSeatPerson('contact', row)),
  ];
  return query.limit ? people.slice(0, query.limit) : people;
}

export const coManagedSeatPeopleProjector: SubjectPeopleProjector = {
  resolverId: CO_MANAGED_SEAT_RESOLVER_ID,
  appliesTo: (subject) => isCoManagedSeatSubject(subject),
  people: (db, subject, query) => projectSeatPeople(db, subject.tenant, coManagedSeatAuthority(subject)?.scope ?? null, query),
};

/** Idempotent: registering again replaces the earlier registration. */
export function registerCoManagedSeatPeopleProjector(): void {
  registerSubjectPeopleProjector(coManagedSeatPeopleProjector);
}

registerCoManagedSeatPeopleProjector();
