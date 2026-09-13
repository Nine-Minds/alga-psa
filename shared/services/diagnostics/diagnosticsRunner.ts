/**
 * Shared diagnostics execution kernel.
 *
 * One ordered executor owns step timing, exception capture, recommendation
 * accumulation/deduplication, overall-status calculation, and report/bundle
 * assembly. Consumers supply step definitions and a summary/bundle projection;
 * they must not reimplement execution or status folding.
 */

import type {
  DiagnosticsErrorMeta,
  DiagnosticsHttpMeta,
  DiagnosticsReport,
  DiagnosticsStep,
  DiagnosticsStepData,
  DiagnosticsStepStatus,
} from '../../interfaces/diagnostics.interfaces';

export type {
  DiagnosticsErrorMeta,
  DiagnosticsHttpMeta,
  DiagnosticsReport,
  DiagnosticsStep,
  DiagnosticsStepData,
  DiagnosticsStepStatus,
} from '../../interfaces/diagnostics.interfaces';

export interface DiagnosticsStepOutcome<TData extends DiagnosticsStepData = DiagnosticsStepData> {
  status: DiagnosticsStepStatus;
  /** Domain-specific human summary (Teams). */
  detail?: string;
  http?: DiagnosticsHttpMeta;
  data?: TData;
  error?: DiagnosticsErrorMeta;
  recommendations?: string[];
}

export interface DiagnosticsStepDefinition<
  TContext,
  TData extends DiagnosticsStepData = DiagnosticsStepData,
> {
  id: string;
  title: string;
  run: (context: TContext) => Promise<DiagnosticsStepOutcome<TData>>;
}

export interface DiagnosticsRunOutcome<TData extends DiagnosticsStepData = DiagnosticsStepData> {
  createdAt: string;
  overallStatus: DiagnosticsStepStatus;
  steps: DiagnosticsStep<TData>[];
  recommendations: string[];
}

export interface DiagnosticsErrorNormalization {
  error: DiagnosticsErrorMeta;
  recommendations?: string[];
}

export interface RunDiagnosticsOptions<
  TContext,
  TData extends DiagnosticsStepData = DiagnosticsStepData,
> {
  context: TContext;
  steps: Array<DiagnosticsStepDefinition<TContext, TData>>;
  /** Seed recommendations, inserted before any step-provided ones. */
  recommendations?: Iterable<string>;
  /**
   * Normalize a thrown step error into structured metadata and optional
   * recommendations. Consumers that talk to Graph supply classifyGraphFailure
   * here so thrown errors keep status/code/request-id evidence.
   */
  onError?: (
    error: unknown,
    step: DiagnosticsStepDefinition<TContext, TData>,
    context: TContext,
  ) => DiagnosticsErrorNormalization;
  /** Stop after the current step when this returns true. */
  shouldStop?: (
    step: DiagnosticsStepDefinition<TContext, TData>,
    outcome: DiagnosticsStepOutcome<TData>,
    context: TContext,
  ) => boolean;
}

export function defaultErrorMeta(error: unknown): DiagnosticsErrorMeta {
  if (error instanceof Error) {
    return { message: error.message };
  }
  if (typeof error === 'string') {
    return { message: error };
  }
  return { message: 'Unknown error' };
}

/**
 * fail beats warn beats pass; an empty/all-skip report is a pass (legacy
 * behavior preserved from both existing consumers).
 */
export function computeOverallStatus(
  steps: Array<Pick<DiagnosticsStep, 'status'>>,
): DiagnosticsStepStatus {
  if (steps.some((step) => step.status === 'fail')) return 'fail';
  if (steps.some((step) => step.status === 'warn')) return 'warn';
  return 'pass';
}

export async function runDiagnosticsSteps<
  TContext,
  TData extends DiagnosticsStepData = DiagnosticsStepData,
>(options: RunDiagnosticsOptions<TContext, TData>): Promise<DiagnosticsRunOutcome<TData>> {
  const createdAt = new Date().toISOString();
  const steps: DiagnosticsStep<TData>[] = [];
  const recommendations = new Set<string>();
  const addRecommendations = (entries?: Iterable<string>) => {
    for (const entry of entries ?? []) {
      if (entry) recommendations.add(entry);
    }
  };

  addRecommendations(options.recommendations);

  for (const step of options.steps) {
    const stepStarted = Date.now();
    const stepIso = new Date().toISOString();
    let outcome: DiagnosticsStepOutcome<TData>;

    try {
      outcome = await step.run(options.context);
      addRecommendations(outcome.recommendations);
    } catch (error) {
      const normalized = options.onError?.(error, step, options.context) ?? {
        error: defaultErrorMeta(error),
      };
      addRecommendations(normalized.recommendations);
      outcome = { status: 'fail', error: normalized.error };
    }

    steps.push({
      id: step.id,
      title: step.title,
      status: outcome.status,
      startedAt: stepIso,
      durationMs: Math.max(0, Date.now() - stepStarted),
      ...(outcome.detail !== undefined ? { detail: outcome.detail } : {}),
      ...(outcome.http ? { http: outcome.http } : {}),
      ...(outcome.data ? { data: outcome.data } : {}),
      ...(outcome.error ? { error: outcome.error } : {}),
    });

    if (options.shouldStop?.(step, outcome, options.context)) break;
  }

  return {
    createdAt,
    overallStatus: computeOverallStatus(steps),
    steps,
    recommendations: Array.from(recommendations),
  };
}

export interface AssembleDiagnosticsReportOptions<
  TContext,
  TData extends DiagnosticsStepData = DiagnosticsStepData,
  TSummary = Record<string, unknown>,
> {
  run: DiagnosticsRunOutcome<TData>;
  context: TContext;
  buildSummary: (input: {
    run: DiagnosticsRunOutcome<TData>;
    context: TContext;
  }) => TSummary;
  buildSupportBundle: (input: {
    run: DiagnosticsRunOutcome<TData>;
    summary: TSummary;
    context: TContext;
  }) => Record<string, unknown>;
}

export function assembleDiagnosticsReport<
  TContext,
  TData extends DiagnosticsStepData = DiagnosticsStepData,
  TSummary = Record<string, unknown>,
>(
  options: AssembleDiagnosticsReportOptions<TContext, TData, TSummary>,
): DiagnosticsReport<TSummary, TData> {
  const summary = options.buildSummary({ run: options.run, context: options.context });
  return {
    createdAt: options.run.createdAt,
    summary,
    steps: options.run.steps,
    recommendations: options.run.recommendations,
    supportBundle: options.buildSupportBundle({
      run: options.run,
      summary,
      context: options.context,
    }),
  };
}
