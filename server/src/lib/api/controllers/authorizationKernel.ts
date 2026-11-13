import { Knex } from 'knex';
import { getAuthorizationKernel } from 'server/src/lib/authorization/kernel';
import {
  assembleAuthorizationSubject,
  normalizeIdsFromObjects,
  normalizeStringArray,
  resolveAuthorizationSubject,
  roleIdsCarriedByUser,
} from '@alga-psa/authorization/subject';
import { RequestLocalAuthorizationCache } from '@alga-psa/authorization/kernel';
import type {
  AuthorizationRecord,
  AuthorizationSubject,
} from '@alga-psa/authorization/kernel/contracts';

/**
 * The pure step of subject resolution for a principal whose facts the caller
 * already holds (roles, teams and reports carried on the user object). It shares
 * `assembleAuthorizationSubject` with the database resolver, so the two cannot
 * disagree about what a subject is. Request paths that can reach the database use
 * `resolveAuthorizationSubject`, which also reads the stored portfolio.
 */
export function buildAuthorizationPrincipalSubject(
  user: any,
  apiKeyId?: string,
  storedPortfolioClientIds: readonly string[] = []
): AuthorizationSubject {
  const subject = assembleAuthorizationSubject({
    tenant: user?.tenant ?? '',
    user: user ?? {},
    apiKeyId,
    facts: {
      roleIds: roleIdsCarriedByUser(user ?? {}),
      teamIds: [
        ...normalizeIdsFromObjects(user?.teams, 'team_id'),
        ...normalizeStringArray(user?.team_ids),
      ],
      managedUserIds: [
        ...normalizeStringArray(user?.managed_user_ids),
        ...normalizeStringArray(user?.managedUserIds),
      ],
      storedPortfolioClientIds,
    },
  });
  return subject;
}

export async function authorizeApiResourceAction(input: {
  knex: Knex | Knex.Transaction;
  tenant: string;
  user: any;
  apiKeyId?: string;
  resource: string;
  action: string;
  recordContext: AuthorizationRecord;
}): Promise<boolean> {
  const kernel = await getAuthorizationKernel();
  const requestCache = new RequestLocalAuthorizationCache();
  const subject = await resolveAuthorizationSubject(input.knex, {
    tenant: input.tenant,
    user: input.user,
    apiKeyId: input.apiKeyId,
    requestCache,
  });

  const evaluation = {
    knex: input.knex as any,
    subject,
    requestCache,
    resource: { type: input.resource, action: input.action },
    record: input.recordContext,
  };
  // A write is decided by the kernel's mutation path, which also requires the
  // subject's read rules to allow the record before an update or delete.
  const decision = input.action === 'read'
    ? await kernel.authorizeResource(evaluation)
    : await kernel.authorizeMutation(evaluation);

  return decision.allowed;
}

// Keep the existing generic name for callers that already pass an explicit action.
export const authorizeApiResource = authorizeApiResourceAction;

export async function authorizeApiResourceRead(input: {
  knex: Knex | Knex.Transaction;
  tenant: string;
  user: any;
  apiKeyId?: string;
  resource: string;
  recordContext: AuthorizationRecord;
}): Promise<{ allowed: boolean; redactedFields: string[] }> {
  const kernel = await getAuthorizationKernel();
  const requestCache = new RequestLocalAuthorizationCache();
  const subject = await resolveAuthorizationSubject(input.knex, {
    tenant: input.tenant,
    user: input.user,
    apiKeyId: input.apiKeyId,
    requestCache,
  });

  const decision = await kernel.authorizeResource({
    knex: input.knex as any,
    subject,
    requestCache,
    resource: { type: input.resource, action: 'read' },
    record: input.recordContext,
  });

  return { allowed: decision.allowed, redactedFields: decision.redactedFields ?? [] };
}
