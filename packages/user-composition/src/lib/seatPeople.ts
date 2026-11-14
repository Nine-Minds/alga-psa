import type { Knex } from 'knex';
import { projectPeopleForUser, type PeopleProjectionQuery, type ProjectedPerson } from '@alga-psa/authorization/subject/peopleProjection';
import type { IUserWithRoles } from '@alga-psa/types';
import { getEntityImageUrlsBatch } from './avatarUtils';

/**
 * The people a restricted (seat) caller may see, for every user list, picker and mention source in this
 * package. `null` means the caller is not restricted and the source answers exactly as it always did.
 * An array, empty included, is the whole answer: a restricted caller never falls through to the
 * unfiltered list, and never needs `user:read` for it (the projection is its grant).
 *
 * The caller is detected through the authorization package's projector registry: membership in the
 * resolver's subject index, then the resolved subject. No co-managed table is read for anyone else.
 */
export async function projectedPeopleForCaller(
  trx: Knex | Knex.Transaction,
  tenant: string,
  currentUser: { user_id?: string; user_type?: string },
  query?: PeopleProjectionQuery,
): Promise<ProjectedPerson[] | null> {
  // A portal user is never a restricted internal subject.
  if (currentUser.user_type === 'client') return null;
  return projectPeopleForUser(trx, { tenant, user: currentUser }, query);
}

/** The people that are users (a contact without a portal login is not), keyed by user id. */
export const projectedUsers = (people: readonly ProjectedPerson[]) =>
  people.filter((person): person is ProjectedPerson & { userId: string } => person.userId !== null);

/**
 * A masked person as a user row. Only released fields are set, so a withheld column (email, phone,
 * username of MSP staff) is absent from the serialized row, not blank. The `IUser` type cannot say that,
 * hence the cast.
 */
export function projectedPersonToUser(
  person: ProjectedPerson & { userId: string },
  tenant: string,
  avatarUrl?: string | null,
): IUserWithRoles {
  const row: Record<string, unknown> = {
    user_id: person.userId,
    tenant,
    user_type: person.kind === 'contact' ? 'client' : 'internal',
    is_inactive: false,
    roles: [],
  };
  if (person.firstName != null) row.first_name = person.firstName;
  if (person.lastName != null) row.last_name = person.lastName;
  if (person.username != null) row.username = person.username;
  if (person.email != null) row.email = person.email;
  if (person.contactId) row.contact_id = person.contactId;
  if (avatarUrl !== undefined) row.avatarUrl = avatarUrl;
  return row as unknown as IUserWithRoles;
}

/** User rows for a seat caller's list, avatars attached from the person's reference. */
export async function projectedPeopleAsUsers(
  people: readonly ProjectedPerson[],
  tenant: string,
  options: { userType?: string } = {},
): Promise<IUserWithRoles[]> {
  const users = projectedUsers(people).filter((person) =>
    options.userType ? (person.kind === 'contact' ? 'client' : 'internal') === options.userType : true);
  const avatars = await getEntityImageUrlsBatch('user', users.map((person) => person.userId), tenant);
  return users.map((person) => projectedPersonToUser(person, tenant, avatars.get(person.userId) ?? null));
}

