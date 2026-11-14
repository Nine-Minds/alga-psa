import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import type { AuthorizationSubject } from '../kernel/contracts';
import { RequestLocalAuthorizationCache } from '../kernel/requestCache';
import type { SubjectUserInput } from './assemble';
import { resolveAuthorizationSubject } from './resolver';

/**
 * Registry of "which people may this subject see" projectors.
 *
 * Where a built-in rule resolver (`registerBuiltinRuleResolver`) decides which RECORDS a class of subjects may
 * reach, a people projector decides which PEOPLE appear in the user lists, pickers and mention suggestions of
 * that class. A package that owns a class of restricted subjects registers one projector, keyed by the id of the
 * resolver that defines the class (the membership index that resolver already maintains gates it, so a tenant
 * with no subject of the class never reads the class's feature tables).
 *
 * Every user list, picker and mention source asks `projectPeopleForUser`. `null` means the caller is not
 * restricted and the source answers as it always did; an array, even an empty one, is the whole answer.
 * A restricted subject therefore can never fall back to the unfiltered list.
 */

export type ProjectedPersonKind = 'msp_staff' | 'client_technician' | 'contact';

/** The attributes of a person a projection may release. A kind's mask is the subset it releases. */
export type ProjectedPersonField = 'displayName' | 'firstName' | 'lastName' | 'username' | 'email' | 'phone';

/**
 * One visible person. Only the fields in the kind's mask are present. `userId` / `contactId` are the person's
 * reference (also the key of their avatar) and are always set for the matching kind.
 */
export interface ProjectedPerson {
  kind: ProjectedPersonKind;
  userId: string | null;
  contactId: string | null;
  /** The client a `contact` belongs to; null for staff and technicians. */
  clientId?: string | null;
  displayName: string;
  firstName?: string | null;
  lastName?: string | null;
  username?: string | null;
  email?: string | null;
  phone?: string | null;
}

export interface PeopleProjectionQuery {
  /** Case-insensitive match on the person's name (and, where released, username). */
  search?: string;
  /** Restrict to these kinds. Absent means every kind the subject may see. */
  kinds?: readonly ProjectedPersonKind[];
  limit?: number;
}

export interface SubjectPeopleProjector {
  /** The id of the built-in rule resolver whose membership index defines this projector's class. */
  resolverId: string;
  /** Whether the resolved subject belongs to the class. */
  appliesTo(subject: AuthorizationSubject): boolean;
  /** The people the subject may see. Empty when the subject holds nothing. */
  people(knex: Knex | Knex.Transaction, subject: AuthorizationSubject, query: PeopleProjectionQuery): Promise<ProjectedPerson[]>;
}

// Keyed on globalThis so duplicated module instances (dev HMR, split bundles) share one registry.
const STORE_KEY = Symbol.for('alga.authorization.subjectPeopleProjectors');
function store(): Map<string, SubjectPeopleProjector> {
  const holder = globalThis as unknown as Record<symbol, Map<string, SubjectPeopleProjector> | undefined>;
  return (holder[STORE_KEY] ??= new Map());
}

/** Idempotent per resolver id. */
export function registerSubjectPeopleProjector(projector: SubjectPeopleProjector): void {
  if (!projector.resolverId) throw new Error('A people projector needs the id of its resolver');
  store().set(projector.resolverId, projector);
}

export function unregisterSubjectPeopleProjector(resolverId: string): void {
  store().delete(resolverId);
}

export interface ProjectPeopleForUserInput {
  tenant: string;
  user: SubjectUserInput;
}

/**
 * The people `user` may see, or null when no projector claims them (the caller is not restricted).
 *
 * Gate: nothing registered, or the user is not in the membership index of a registered projector's resolver,
 * returns null after at most one indexed read of `authorization_resolver_subjects`. The projector's own tables
 * are read only for a member.
 */
export async function projectPeopleForUser(
  knex: Knex | Knex.Transaction,
  input: ProjectPeopleForUserInput,
  query: PeopleProjectionQuery = {},
): Promise<ProjectedPerson[] | null> {
  const projectors = [...store().values()];
  const userId = input.user.user_id;
  if (projectors.length === 0 || !userId) return null;

  const member = await tenantDb(knex, input.tenant).table('authorization_resolver_subjects')
    .where({ user_id: userId })
    .whereIn('resolver_id', projectors.map((projector) => projector.resolverId))
    .first('resolver_id');
  if (!member) return null;

  const subject = await resolveAuthorizationSubject(knex, {
    tenant: input.tenant, user: input.user, requestCache: new RequestLocalAuthorizationCache(),
  });
  return projectPeopleForSubject(knex, subject, query);
}

/**
 * The people an already-resolved `subject` may see, or null when no projector claims it. For callers that hold
 * the subject (a ticket's authorization context): the class is decided from the subject's own facts, so a
 * subject no projector claims costs no statement. Only a claimed subject reads its projector's tables.
 */
export async function projectPeopleForSubject(
  knex: Knex | Knex.Transaction,
  subject: AuthorizationSubject,
  query: PeopleProjectionQuery = {},
): Promise<ProjectedPerson[] | null> {
  const projector = [...store().values()].find((candidate) => candidate.appliesTo(subject));
  return projector ? projector.people(knex, subject, query) : null;
}
