import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import type { AuthorizationRequestCache, AuthorizationSubject } from '../kernel/contracts';
import { RequestLocalAuthorizationCache } from '../kernel/requestCache';
import { readUserClientPortfolio } from '../portfolios/service';
import { loadBuiltinResolverFacts } from '../kernel/builtinRuleResolvers';
import {
  assembleAuthorizationSubject,
  roleIdsCarriedByUser,
  type AuthorizationSubjectFacts,
  type SubjectUserInput,
} from './assemble';
import { probeTenantAuthorizationScope } from './tenantScope';

/**
 * The one place an `AuthorizationSubject` is built from the database.
 *
 * Every loader failure propagates: a subject that cannot be resolved gets no
 * decision, hence no access. Nothing here turns a fault into an empty answer.
 */

export interface LoadAuthorizationSubjectFactsInput {
  tenant: string;
  user: SubjectUserInput;
  /** Share one cache across a request so the tenant probe runs once. */
  requestCache?: AuthorizationRequestCache;
}

export interface ResolveAuthorizationSubjectInput extends LoadAuthorizationSubjectFactsInput {
  apiKeyId?: string | null;
}

export async function loadAuthorizationSubjectFacts(
  knex: Knex | Knex.Transaction,
  input: LoadAuthorizationSubjectFactsInput
): Promise<AuthorizationSubjectFacts> {
  const { tenant, user } = input;
  const userId = user.user_id;
  if (!tenant || !userId) {
    throw new Error('Authorization subject requires tenant and user identity');
  }

  const requestCache = input.requestCache ?? new RequestLocalAuthorizationCache();
  const db = tenantDb(knex, tenant);

  // Roles ride along with the user when the caller loaded them; the database is asked only when they did not.
  let roleIds = roleIdsCarriedByUser(user);
  if (roleIds.length === 0) {
    const roleRows = await db.table('user_roles').where({ user_id: userId }).select<{ role_id: string }[]>('role_id');
    roleIds = roleRows.map((row) => row.role_id);
  }

  const [teamRows, managedRows, scope] = await Promise.all([
    db.table('team_members').where({ user_id: userId }).select<{ team_id: string }[]>('team_id'),
    db.table('users').where({ reports_to: userId }).select<{ user_id: string }[]>('user_id'),
    probeTenantAuthorizationScope(knex, tenant, requestCache),
  ]);

  // Fast path: a tenant with no portfolio rows has no stored portfolio for anyone.
  const storedPortfolioClientIds = scope.portfolios
    ? await readUserClientPortfolio(knex, { tenant, userId })
    : [];

  // Fast path: no registered resolver's fact source has a subject in this tenant, so nothing is read.
  const resolverFacts = scope.resolverSubjects !== false ? await loadBuiltinResolverFacts(knex, { tenant, userId }) : undefined;

  return {
    roleIds,
    teamIds: teamRows.map((row) => row.team_id),
    managedUserIds: managedRows.map((row) => row.user_id),
    storedPortfolioClientIds,
    ...(resolverFacts ? { resolverFacts } : {}),
  };
}

export async function resolveAuthorizationSubject(
  knex: Knex | Knex.Transaction,
  input: ResolveAuthorizationSubjectInput
): Promise<AuthorizationSubject> {
  const facts = await loadAuthorizationSubjectFacts(knex, input);
  return assembleAuthorizationSubject({
    tenant: input.tenant,
    user: input.user,
    facts,
    apiKeyId: input.apiKeyId,
  });
}
