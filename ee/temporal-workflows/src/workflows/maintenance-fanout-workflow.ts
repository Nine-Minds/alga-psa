import { proxyActivities } from '@temporalio/workflow';
import type * as activities from '../activities';

const { runMaintenanceJobActivity } = proxyActivities<typeof activities>({
  startToCloseTimeout: '15m',
});

export interface MaintenanceJobWorkflowInput {
  jobName: string;
}

// Thin schedule-driven workflow: one global Temporal Schedule per maintenance
// job fires this, which fans the job out across tenants in the activity. The
// schedule's overlap=SKIP policy prevents a slow run from stacking up.
export async function maintenanceJobWorkflow(input: MaintenanceJobWorkflowInput): Promise<void> {
  await runMaintenanceJobActivity(input);
}
