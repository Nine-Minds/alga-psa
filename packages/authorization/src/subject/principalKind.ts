import type { Knex } from 'knex';
import type { AuthorizationSubject } from '../kernel/contracts';
import {
  builtinPrincipalKindResolvers,
  loadBuiltinResolverFacts,
  principalKindOfSubject,
  type BuiltinResolverPrincipalKind,
} from '../kernel/builtinRuleResolvers';
import { builtinResolverSubjectsQuery } from './resolverSubjects';

/**
 * Which kind of principal a user is, for everything that depends on the principal's surface rather than
 * its permissions: the routes and menu it sees, the server actions it may reach, and whether it may hold
 * API credentials.
 *
 * The answer comes from the same facts as the authorization subject. A user is in a kind's class only if
 * the resolver that declares the kind says so, so there is one definition of the class, not one for
 * authorization and another for the surface.
 *
 * Cost. The membership index (`authorization_resolver_subjects`) is read as one EXISTS that a caller
 * folds into a statement it already issues (the tenant row, the API-key owner row). An ordinary user
 * costs no statement of its own; only a member pays one more, for the facts. Nothing is cached across
 * requests, so a change to a user's seat decides their next request.
 */

export interface PrincipalKindInput {
  tenant: string;
  userId: string;
}

/**
 * A boolean scalar expression: whether the user is in the membership index of any resolver that declares a
 * principal kind. Null when no such resolver is registered, so the caller selects nothing. Conservative by
 * construction (membership outlives revocation); `resolvePrincipalKind` decides from the facts.
 */
export function principalMembershipExpression(
  knex: Knex | Knex.Transaction,
  input: PrincipalKindInput,
): Knex.Raw | null {
  const resolvers = builtinPrincipalKindResolvers();
  if (resolvers.length === 0) return null;
  return knex.raw(
    `(${resolvers.map(() => 'exists(?)').join(' or ')})`,
    resolvers.map((resolver) =>
      builtinResolverSubjectsQuery(knex, input.tenant, resolver.id).where('user_id', input.userId).select(knex.raw('1'))),
  );
}

/**
 * The principal kind of a user; null for an ordinary principal. `member` is the value of
 * `principalMembershipExpression` when the caller already selected it: false settles the answer with no
 * statement. Anything but an explicit false is treated as a possible member, so the facts decide. A failed
 * load propagates: when the class cannot be read, nothing is granted.
 */
export async function resolvePrincipalKind(
  knex: Knex | Knex.Transaction,
  input: PrincipalKindInput & { member?: unknown },
): Promise<BuiltinResolverPrincipalKind | null> {
  if (builtinPrincipalKindResolvers().length === 0 || input.member === false) return null;
  const resolverFacts = await loadBuiltinResolverFacts(knex, input);
  if (!resolverFacts) return null;
  return principalKindOfSubject({ tenant: input.tenant, userId: input.userId, resolverFacts } as AuthorizationSubject);
}

/** Whether the user may hold API credentials: issue, authenticate with, or reach REST and MCP. */
export async function mayHoldApiCredentials(
  knex: Knex | Knex.Transaction,
  input: PrincipalKindInput & { member?: unknown },
): Promise<boolean> {
  return (await resolvePrincipalKind(knex, input))?.apiCredentials !== 'refused';
}

/**
 * Columns to add to a statement that already reads the user's row, so that `resolvePrincipalKind` and
 * `mayHoldApiCredentials` need no statement of their own for an ordinary user. Empty when no principal kind
 * is registered. Pass the row's `principal_member` back as `member`.
 */
export function principalMemberColumns(
  knex: Knex | Knex.Transaction,
  input: PrincipalKindInput,
): Knex.Raw[] {
  const membership = principalMembershipExpression(knex, input);
  return membership ? [knex.raw('? as principal_member', [membership])] : [];
}

/** An API credential was refused because the user's principal kind may not hold one. */
export class ApiCredentialsRefusedError extends Error {
  public readonly code = 'API_CREDENTIALS_REFUSED';
  constructor(message = 'API credentials are not available for this account') {
    super(message);
    this.name = 'ApiCredentialsRefusedError';
  }
}

export function isApiCredentialsRefusedError(error: unknown): error is ApiCredentialsRefusedError {
  return error instanceof ApiCredentialsRefusedError ||
    (typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'API_CREDENTIALS_REFUSED');
}
