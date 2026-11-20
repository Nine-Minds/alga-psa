import type { ServiceContext } from '@alga-psa/db';
import type { IUserWithRoles } from '@alga-psa/types';

/**
 * The subject a REST service call runs as, in the shape the client-scope narrowing takes.
 *
 * The transport verifies `userId` (and `apiKeyId` for a key) and may attach the loaded user; the verified ids win over
 * whatever the loaded user object says. Roles, teams and portfolio are read from the database by the subject resolver,
 * so a context that carries only ids still resolves to the same subject.
 */
export function subjectFromServiceContext(context: ServiceContext): IUserWithRoles {
  return {
    ...(context.user ?? {}),
    user_id: context.userId,
    ...(context.apiKeyId ? { apiKeyId: context.apiKeyId } : {}),
  } as IUserWithRoles;
}
