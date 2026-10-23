import type {
  DiagnosticsStep,
  DiagnosticsStepStatus,
} from '@alga-psa/types';

/**
 * Fold a set of steps into an overall status. Precedence is fail > warn >
 * pass. Skipped steps never create a failure on their own.
 */
export function computeOverallStatus(
  steps: Pick<DiagnosticsStep, 'status'>[]
): DiagnosticsStepStatus {
  if (steps.some((s) => s.status === 'fail')) return 'fail';
  if (steps.some((s) => s.status === 'warn')) return 'warn';
  return 'pass';
}
