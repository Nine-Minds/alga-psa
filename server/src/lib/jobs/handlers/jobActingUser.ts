import { getUserWithRoles, runWithTenant } from '@alga-psa/db';
import { runWithApiKeyUser } from '@alga-psa/auth';

/**
 * Run a job handler as the user who enqueued it.
 *
 * Background jobs have no session, but handlers that reach into withAuth
 * server actions (e.g. invoice rendering) still need an acting user. This
 * resolves the enqueuer from job data and installs it via the same override
 * `resolveCurrentUser` consults before any session lookup, plus the tenant
 * context the storage/db layers read from AsyncLocalStorage.
 */
export async function runAsJobActingUser<T>(
  params: { jobName: string; tenantId: string; userId: string | undefined },
  fn: () => Promise<T>
): Promise<T> {
  const { jobName, tenantId, userId } = params;
  if (!userId) {
    throw new Error(`${jobName} requires user_id in job data to act on the enqueuer's behalf`);
  }

  return runWithTenant(tenantId, async () => {
    const user = await getUserWithRoles(userId, tenantId);
    if (!user || user.is_inactive) {
      throw new Error(
        `${jobName} could not resolve an active acting user ${userId} for tenant ${tenantId}`
      );
    }
    return runWithApiKeyUser(user, fn);
  });
}
