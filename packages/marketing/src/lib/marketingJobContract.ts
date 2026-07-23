export const MARKETING_FLIP_DUE_POSTS_JOB = 'marketing:flip-due-posts' as const;
export const MARKETING_EXPIRE_STALE_TARGETS_JOB = 'marketing:expire-stale-targets' as const;
export const MARKETING_SEND_SEQUENCE_STEPS_JOB = 'marketing:send-sequence-steps' as const;

export const MARKETING_JOB_NAMES = [
  MARKETING_FLIP_DUE_POSTS_JOB,
  MARKETING_EXPIRE_STALE_TARGETS_JOB,
  MARKETING_SEND_SEQUENCE_STEPS_JOB,
] as const;

export type MarketingJobName = (typeof MARKETING_JOB_NAMES)[number];

export interface MarketingJobData extends Record<string, unknown> {
  tenantId: string;
}

export interface MarketingJobInput {
  jobName: MarketingJobName;
  tenantId: string;
}

export interface MarketingFlipDuePostsSummary {
  flipped: number;
}

export interface MarketingExpireStaleTargetsSummary {
  expired: number;
}

export interface MarketingSequenceSendSummary {
  sent: number;
  completed: number;
  stopped: number;
  failed: number;
  skipped: number;
}

export interface MarketingJobOperationSummaryMap {
  [MARKETING_FLIP_DUE_POSTS_JOB]: MarketingFlipDuePostsSummary;
  [MARKETING_EXPIRE_STALE_TARGETS_JOB]: MarketingExpireStaleTargetsSummary;
  [MARKETING_SEND_SEQUENCE_STEPS_JOB]: MarketingSequenceSendSummary;
}

export type MarketingTenantJobResult = {
  [JobName in MarketingJobName]: {
    jobName: JobName;
    tenantId: string;
    operation: MarketingJobOperationSummaryMap[JobName];
    completedAt: string;
  };
}[MarketingJobName];

export interface MarketingFanoutSuccess {
  tenantId: string;
  status: 'succeeded';
  result: MarketingTenantJobResult;
}

export interface MarketingFanoutFailure {
  tenantId: string;
  status: 'failed';
  error: string;
}

export type MarketingFanoutTenantResult =
  | MarketingFanoutSuccess
  | MarketingFanoutFailure;

export interface MarketingFanoutSummary {
  jobName: MarketingJobName;
  total: number;
  succeeded: number;
  failed: number;
  results: MarketingFanoutTenantResult[];
}

export function isMarketingJobName(value: unknown): value is MarketingJobName {
  return typeof value === 'string'
    && MARKETING_JOB_NAMES.includes(value as MarketingJobName);
}

export function assertMarketingJobName(value: unknown): asserts value is MarketingJobName {
  if (!isMarketingJobName(value)) {
    throw new Error(`Unknown marketing job name: ${String(value)}`);
  }
}
