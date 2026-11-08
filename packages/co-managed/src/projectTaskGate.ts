import { serves } from '@alga-psa/core/capability';
import { CoManagedSharedWorkError } from './sharedWorkIdentity';

/** The existing L0a capability gate, consulted before any shared project/task statement runs.
 * `serves` (not `admits`): shared projects and tasks that already exist keep working for a
 * participating tenant; the kill switch (`FORCE_CAPABILITIES=co-managed:off`) and a tenant the
 * gate does not serve both answer as the same opaque denial as an out-of-scope task. */
export async function assertCoManagedProjectWorkServed(tenant: string): Promise<void> {
  if (!(await serves('co-managed', tenant)).served) throw new CoManagedSharedWorkError();
}
