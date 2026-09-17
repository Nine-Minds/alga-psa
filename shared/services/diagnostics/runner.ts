import type {
  DiagnosticsErrorMeta,
  DiagnosticsStep,
  DiagnosticsStepResult,
} from '@alga-psa/types';

export interface DiagnosticsRunnerOptions {
  /**
   * Converts an unexpected thrown error into safe metadata. Defaults to a
   * generic message that never carries the raw error body.
   */
  classifyError?: (error: unknown) => DiagnosticsErrorMeta;
  /**
   * Called after an unexpected error is classified. Domain-specific callers
   * use this to collect recommendations without changing the generic runner.
   */
  onError?: (error: unknown, stepId: string, errorMeta: DiagnosticsErrorMeta) => void;
}

export interface DiagnosticsRunner {
  steps: DiagnosticsStep[];
  push(step: DiagnosticsStep): void;
  runStep(
    id: string,
    title: string,
    fn: () => Promise<DiagnosticsStepResult>
  ): Promise<DiagnosticsStep>;
}

function defaultClassifyError(error: unknown): DiagnosticsErrorMeta {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : 'Unexpected diagnostics error';
  return { message };
}

/**
 * Generic timed step runner. Steps are pushed in execution order and each step
 * records its own start time and duration. A thrown error becomes a `fail`
 * step with classified metadata; it never aborts the remaining steps.
 */
export function createDiagnosticsRunner(
  options: DiagnosticsRunnerOptions = {}
): DiagnosticsRunner {
  const steps: DiagnosticsStep[] = [];
  const classifyError = options.classifyError ?? defaultClassifyError;

  const push = (step: DiagnosticsStep) => {
    steps.push(step);
  };

  const runStep = async (
    id: string,
    title: string,
    fn: () => Promise<DiagnosticsStepResult>
  ): Promise<DiagnosticsStep> => {
    const stepStarted = Date.now();
    const startedAt = new Date().toISOString();
    try {
      const partial = await fn();
      const step: DiagnosticsStep = {
        id,
        title,
        startedAt,
        durationMs: Date.now() - stepStarted,
        status: partial.status,
        http: partial.http,
        data: partial.data,
        error: partial.error,
      };
      push(step);
      return step;
    } catch (error: unknown) {
      const errorMeta = classifyError(error);
      options.onError?.(error, id, errorMeta);
      const step: DiagnosticsStep = {
        id,
        title,
        startedAt,
        durationMs: Date.now() - stepStarted,
        status: 'fail',
        error: errorMeta,
      };
      push(step);
      return step;
    }
  };

  return { steps, push, runStep };
}
