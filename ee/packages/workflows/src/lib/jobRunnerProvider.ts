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

let workflowScheduleJobRunnerFactory: (() => Promise<WorkflowScheduleJobRunner>) | null = null;

export const registerWorkflowScheduleJobRunner = (
  factory: () => Promise<WorkflowScheduleJobRunner>
): void => {
  workflowScheduleJobRunnerFactory = factory;
};

export const resetWorkflowScheduleJobRunner = (): void => {
  workflowScheduleJobRunnerFactory = null;
};

export const getWorkflowScheduleJobRunner = async (): Promise<WorkflowScheduleJobRunner> => {
  if (!workflowScheduleJobRunnerFactory) {
    throw new Error('Workflow schedule job runner has not been registered');
  }
  return workflowScheduleJobRunnerFactory();
};
