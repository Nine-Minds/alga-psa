import {
  assembleAuthorizationSubject,
  roleIdsCarriedByUser,
  type SubjectUserInput,
} from '@alga-psa/authorization/subject/assemble';

/** Loaded subject facts for route fixtures with no stored memberships or portfolio. */
export async function resolveFixtureAuthorizationSubject(
  _knex: unknown,
  input: { tenant: string; user: SubjectUserInput; apiKeyId?: string | null },
) {
  return assembleAuthorizationSubject({
    tenant: input.tenant,
    user: input.user,
    apiKeyId: input.apiKeyId,
    facts: {
      roleIds: roleIdsCarriedByUser(input.user),
      teamIds: [],
      managedUserIds: [],
      storedPortfolioClientIds: [],
    },
  });
}
