// Job status + metadata types live in horizontal @alga-psa/types so vertical
// feature packages (billing, client-portal) can consume them without importing
// @alga-psa/jobs (which would create a vertical -> jobs dependency cycle, since
// @alga-psa/jobs holds the cross-domain job handlers).
export enum JobStatus {
  Pending = 'pending',
  Processing = 'processing',
  Completed = 'completed',
  Failed = 'failed',
  Active = 'active',
  Queued = 'queued'
}

export interface JobMetadata {
  [key: string]: unknown;
}

export interface JobResult {
  [key: string]: unknown;
}
