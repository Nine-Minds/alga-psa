import { configureDateTriggerWorkflowLauncher } from '@alga-psa/jobs/fanout';
import type { DateWorkflowLauncher } from '@alga-psa/jobs/handlers/dateTriggerScanHandler';

/**
 * Resolve the EE date-workflow launcher behind the edition boundary, so CE
 * never imports enterprise code. Returns undefined in CE: the scan still emits
 * date events, it just launches no date-triggered workflows.
 */
export function resolveDateTriggerWorkflowLauncher(includeEnterprise: boolean): DateWorkflowLauncher | undefined {
  if (!includeEnterprise) return undefined;
  const { launchDateTriggeredWorkflows } = require('@alga-psa/workflows/lib/dateTriggerLauncher');
  return launchDateTriggeredWorkflows;
}

/**
 * Point the maintenance fanout's date-trigger-scan at this edition's launcher.
 * Only configures the launcher and starts nothing (no job runner, no DB).
 * Every path that can run the fanout calls it before running.
 */
export function configureEditionDateTriggerWorkflowLauncher(includeEnterprise: boolean): DateWorkflowLauncher | undefined {
  const launcher = resolveDateTriggerWorkflowLauncher(includeEnterprise);
  configureDateTriggerWorkflowLauncher(launcher);
  return launcher;
}
