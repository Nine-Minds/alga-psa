import { cache } from 'react';
import { getSession } from '@alga-psa/auth';
import { createTenantKnex, isCoManagedWorkspace } from '@alga-psa/db';
import { readCoManagedLifecycleLockFree } from '@alga-psa/licensing';

/**
 * Whether the signed-in workspace is a co-managed one that may no longer write (lapsed past grace,
 * relationship ended, or awaiting acceptance). Pages use it to withdraw write controls; the L0c choke
 * point still refuses the writes themselves, so this is presentation, never the gate.
 *
 * Cost: React `cache` makes it at most one evaluation per request. A PSA tenant (and any tenant the
 * L0c negative set already knows is not co-managed) answers false with ZERO queries, and a
 * schema-absent database answers false as well, so the flag-off / non-participating path is unchanged.
 */
export const getWorkspaceReadOnly = cache(async (): Promise<boolean> => {
  const tenant = (await getSession())?.user?.tenant;
  if (!tenant) return false;
  try {
    const { knex } = await createTenantKnex(tenant);
    if (!await isCoManagedWorkspace(knex, tenant)) return false;
    return !(await readCoManagedLifecycleLockFree(knex, tenant)).canWrite;
  } catch {
    // Never turn a failed probe into a locked-out workspace; the write choke point is the authority.
    return false;
  }
});
