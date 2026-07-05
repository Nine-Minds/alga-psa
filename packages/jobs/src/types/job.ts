// Job status/metadata types now live in horizontal @alga-psa/types so vertical
// feature packages can import them without depending on @alga-psa/jobs. Re-export
// here so existing @alga-psa/jobs consumers (server, internal modules) are
// unaffected.
export { JobStatus } from '@alga-psa/types';
export type { JobMetadata, JobResult } from '@alga-psa/types';
