import { configureDateTriggerWorkflowLauncher } from '@alga-psa/jobs/fanout';
import type { DateWorkflowLauncher } from '@alga-psa/jobs/handlers/dateTriggerScanHandler';
import { launchDateTriggeredWorkflows } from '@alga-psa/workflows/lib/dateTriggerLauncher';

/**
 * Resolve the date-workflow launcher for this edition. Returns undefined in CE:
 * the scan still emits date events, it just launches no date-triggered
 * workflows. The launcher is imported statically (like the other
 * `@alga-psa/workflows/lib/*` consumers) because that subpath is exported
 * for ESM `import` only; a CJS `require()` cannot resolve it.
 */
export function resolveDateTriggerWorkflowLauncher(includeEnterprise: boolean): DateWorkflowLauncher | undefined {
  return includeEnterprise ? launchDateTriggeredWorkflows : undefined;
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
