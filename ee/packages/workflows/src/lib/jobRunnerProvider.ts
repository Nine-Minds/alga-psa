export type WorkflowScheduleJobStatusInfo = {
  status: string;
};

export type WorkflowScheduleJobResult = {
  jobId: string;
  externalId: string | null;
};

export type WorkflowScheduleJobRunner = {
  scheduleJobAt(
    jobName: string,
    data: Record<string, unknown>,
    runAt: Date,
    options?: Record<string, unknown>
  ): Promise<WorkflowScheduleJobResult>;
  scheduleRecurringJob(
    jobName: string,
    data: Record<string, unknown>,
    interval: string,
    options?: Record<string, unknown>
  ): Promise<WorkflowScheduleJobResult>;
  cancelJob(jobId: string, tenantId: string): Promise<boolean>;
  getJobStatus(jobId: string, tenantId: string): Promise<WorkflowScheduleJobStatusInfo | null>;
};

const WORKFLOW_SCHEDULE_JOB_RUNNER_FACTORY_KEY = Symbol.for('alga.workflowScheduleJobRunnerFactory');

type WorkflowScheduleJobRunnerFactory = () => Promise<WorkflowScheduleJobRunner>;

type WorkflowScheduleJobRunnerGlobal = typeof globalThis & {
  [WORKFLOW_SCHEDULE_JOB_RUNNER_FACTORY_KEY]?: WorkflowScheduleJobRunnerFactory | null;
};

const getGlobalJobRunnerFactory = (): WorkflowScheduleJobRunnerFactory | null => {
  const globalRegistry = globalThis as WorkflowScheduleJobRunnerGlobal;
  return globalRegistry[WORKFLOW_SCHEDULE_JOB_RUNNER_FACTORY_KEY] ?? null;
};

const setGlobalJobRunnerFactory = (factory: WorkflowScheduleJobRunnerFactory | null): void => {
  const globalRegistry = globalThis as WorkflowScheduleJobRunnerGlobal;
  globalRegistry[WORKFLOW_SCHEDULE_JOB_RUNNER_FACTORY_KEY] = factory;
};

export const registerWorkflowScheduleJobRunner = (
  factory: WorkflowScheduleJobRunnerFactory
): void => {
  setGlobalJobRunnerFactory(factory);
};

export const resetWorkflowScheduleJobRunner = (): void => {
  setGlobalJobRunnerFactory(null);
};

export const getWorkflowScheduleJobRunner = async (): Promise<WorkflowScheduleJobRunner> => {
  const workflowScheduleJobRunnerFactory = getGlobalJobRunnerFactory();
  if (!workflowScheduleJobRunnerFactory) {
    throw new Error('Workflow schedule job runner has not been registered');
  }
  return workflowScheduleJobRunnerFactory();
};
