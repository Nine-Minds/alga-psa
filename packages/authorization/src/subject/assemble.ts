import type { AuthorizationSubject } from '../kernel/contracts';

/**
 * The pure half of subject resolution: turn loaded facts into an
 * `AuthorizationSubject`. Everything that decides what a subject *is* lives here,
 * so a caller that already holds the facts (a single-statement snapshot, a REST
 * principal) shares one definition with the async loader in `resolver.ts`.
 */

/** The identity fields of a user, in whichever shape the caller holds them. */
export interface SubjectUserInput {
  user_id?: string | null;
  user_type?: string | null;
  clientId?: string | null;
  client_id?: string | null;
  apiKeyId?: string | null;
  api_key_id?: string | null;
  /** Role objects (`{ role_id }`) or ids as loaded with the user. */
  roles?: unknown;
  role_ids?: unknown;
}

/** What the database says about a user. */
export interface AuthorizationSubjectFacts {
  roleIds: readonly string[];
  teamIds: readonly string[];
  /** Users whose `reports_to` is this user. */
  managedUserIds: readonly string[];
  /** Rows of `user_client_portfolios` for this user. */
  storedPortfolioClientIds: readonly string[];
  /** Facts of registered built-in rule resolvers, keyed by resolver id; absent when none were loaded. */
  resolverFacts?: Record<string, unknown>;
}

export function normalizeStringArray(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return values.filter((value): value is string => typeof value === 'string' && value.length > 0);
}

export function normalizeIdsFromObjects(values: unknown, key: string): string[] {
  if (!Array.isArray(values)) return [];
  return values
    .map((value) => {
      if (!value || typeof value !== 'object') return null;
      const candidate = (value as Record<string, unknown>)[key];
      return typeof candidate === 'string' && candidate.length > 0 ? candidate : null;
    })
    .filter((value): value is string => value !== null);
}

export function uniqueStrings(values: readonly string[]): string[] {
  return Array.from(new Set(values));
}

/** Role ids the caller already carries on the user object (`roles[]` and/or `role_ids`). */
export function roleIdsCarriedByUser(user: SubjectUserInput): string[] {
  return uniqueStrings([
    ...normalizeIdsFromObjects(user.roles, 'role_id'),
    ...normalizeStringArray(user.roles),
    ...normalizeStringArray(user.role_ids),
  ]);
}

function nonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function subjectClientId(user: SubjectUserInput): string | null {
  return nonEmptyString(user.clientId) ?? nonEmptyString(user.client_id);
}

export function subjectUserType(userType: unknown): AuthorizationSubject['userType'] {
  // 'service' is mapped explicitly; only a missing or legacy type falls back to internal.
  return userType === 'client' ? 'client' : userType === 'service' ? 'service' : 'internal';
}

/**
 * A user's portfolio is the clients they are responsible for: their stored rows,
 * plus, for a user that belongs to a client (a client-portal user), that client.
 * The user's own client is always in scope for them, so a `client_portfolio` rule
 * never locks a client user out of their own client's records. Internal users
 * have no client of their own; their portfolio is exactly what is stored.
 */
export function portfolioForUser(storedClientIds: readonly string[], clientId: string | null): string[] {
  return uniqueStrings([...storedClientIds, ...(clientId ? [clientId] : [])]);
}

export function assembleAuthorizationSubject(input: {
  tenant: string;
  user: SubjectUserInput;
  facts: AuthorizationSubjectFacts;
  apiKeyId?: string | null;
}): AuthorizationSubject {
  const { tenant, user, facts } = input;
  const clientId = subjectClientId(user);
  const apiKeyId = nonEmptyString(input.apiKeyId) ?? nonEmptyString(user.apiKeyId) ?? nonEmptyString(user.api_key_id);

  return {
    tenant,
    userId: typeof user.user_id === 'string' ? user.user_id : '',
    userType: subjectUserType(user.user_type),
    roleIds: uniqueStrings(facts.roleIds),
    teamIds: uniqueStrings(facts.teamIds),
    managedUserIds: uniqueStrings(facts.managedUserIds),
    clientId,
    portfolioClientIds: portfolioForUser(facts.storedPortfolioClientIds, clientId),
    ...(apiKeyId ? { apiKeyId } : {}),
    ...(facts.resolverFacts ? { resolverFacts: facts.resolverFacts } : {}),
  };
}
