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