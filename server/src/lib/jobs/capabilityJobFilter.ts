import { getJobCapabilityFilter, registerJobCapabilityFilter } from '@alga-psa/jobs/fanout';
import { filterServed } from '@alga-psa/core/capability';

/**
 * The job registry holds ONE capability filter, and registering replaces it. The filter is not
 * per-job: `filterServed` dispatches on the capability a descriptor names, so a single wiring
 * serves every capability-gated job. It therefore belongs to the job-registry boot, not to any
 * job definition: both registries call this before defining jobs, and it never replaces a filter
 * somebody else already registered, so no job's gating can be clobbered by definition order.
 */
export function wireJobCapabilityFilter(): void {
  if (getJobCapabilityFilter()) return;
  registerJobCapabilityFilter((capability, tenantIds) => filterServed(capability as Parameters<typeof filterServed>[0], tenantIds));
}
