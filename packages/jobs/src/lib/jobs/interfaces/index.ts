/**
 * Job Runner Interfaces
 *
 * This module exports the core interfaces for the job runner abstraction layer.
 * These interfaces are implemented by both PgBossJobRunner (CE) and TemporalJobRunner (EE).
 */

export type {
  IJobRunner,
  JobHandlerConfig,
  JobRetryConfig,
  ScheduleJobOptions,
  ScheduleJobResult,
  JobStatusInfo,
  BaseJobData,
} from './IJobRunner';

export type {
  IJobRunnerFactory,
  JobRunnerConfig,
  PgBossConfig,
  TemporalConfig,
} from './IJobRunnerFactory';
