import type {
  DiagnosticsErrorMeta,
  DiagnosticsHttpMeta,
  DiagnosticsReport,
  DiagnosticsStep,
  DiagnosticsStepData,
  DiagnosticsStepResult,
  DiagnosticsStepStatus,
} from '@alga-psa/types';
import { computeOverallStatus } from './status';

export type {
  DiagnosticsErrorMeta,
  DiagnosticsHttpMeta,
  DiagnosticsReport,
  DiagnosticsStep,
  DiagnosticsStepData,
  DiagnosticsStepResult,
  DiagnosticsStepStatus,
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

/**
 * The full set of fields a step function may return when run through the
 * declarative list executor. `createDiagnosticsRunner` accepts the narrower
 * `DiagnosticsStepResult` subset.
 */
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

interface TimedStepExecution<TData extends DiagnosticsStepData> {
  step: DiagnosticsStep<TData>;
  /** The normalized outcome, including the synthesized failure outcome. */
  outcome: DiagnosticsStepOutcome<TData>;
}

/**
 * The single timed-step implementation. Every executor in this module
 * (imperative and declarative) routes through it, so step recording, timing
 * and exception capture exist exactly once.
 */
async function executeTimedStep<TData extends DiagnosticsStepData>(params: {
  id: string;
  title: string;
  run: () => Promise<DiagnosticsStepOutcome<TData> | DiagnosticsStepResult<TData>>;
  onError: (error: unknown) => DiagnosticsErrorNormalization;
}): Promise<TimedStepExecution<TData>> {
  const stepStarted = Date.now();
  const startedAt = new Date().toISOString();
  try {
    const outcome = (await params.run()) as DiagnosticsStepOutcome<TData>;
    const step: DiagnosticsStep<TData> = {
      id: params.id,
      title: params.title,
      status: outcome.status,
      startedAt,
      durationMs: Math.max(0, Date.now() - stepStarted),
      ...(outcome.detail !== undefined ? { detail: outcome.detail } : {}),
      ...(outcome.http !== undefined ? { http: outcome.http } : {}),
      ...(outcome.data !== undefined ? { data: outcome.data } : {}),
      ...(outcome.error !== undefined ? { error: outcome.error } : {}),
    };
    return { step, outcome };
  } catch (error: unknown) {
    const normalized = params.onError(error);
    const outcome: DiagnosticsStepOutcome<TData> = { status: 'fail', error: normalized.error };
    const step: DiagnosticsStep<TData> = {
      id: params.id,
      title: params.title,
      status: 'fail',
      startedAt,
      durationMs: Math.max(0, Date.now() - stepStarted),
      error: normalized.error,
    };
    return { step, outcome };
  }
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
  const classifyError = options.classifyError ?? defaultErrorMeta;

  const push = (step: DiagnosticsStep) => {
    steps.push(step);
  };

  const runStep = async (
    id: string,
    title: string,
    fn: () => Promise<DiagnosticsStepResult>
  ): Promise<DiagnosticsStep> => {
    const { step } = await executeTimedStep({
      id,
      title,
      run: fn,
      onError: (error) => {
        const errorMeta = classifyError(error);
        options.onError?.(error, id, errorMeta);
        return { error: errorMeta };
      },
    });
    push(step);
    return step;
  };

  return { steps, push, runStep };
}

/**
 * Declarative executor over a fixed, ordered list of step definitions. It
 * owns recommendation accumulation (insertion-ordered, deduplicated), the
 * overall-status fold and early termination; timing/exception capture are
 * delegated to the shared `executeTimedStep`. Consumers must not reimplement
 * those concerns.
 */
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

  for (const definition of options.steps) {
    const execution = await executeTimedStep<TData>({
      id: definition.id,
      title: definition.title,
      run: async () => {
        const outcome = await definition.run(options.context);
        addRecommendations(outcome.recommendations);
        return outcome;
      },
      onError: (error) => {
        const normalized = options.onError?.(error, definition, options.context) ?? {
          error: defaultErrorMeta(error),
        };
        addRecommendations(normalized.recommendations);
        return normalized;
      },
    });

    steps.push(execution.step);

    if (options.shouldStop?.(definition, execution.outcome, options.context)) break;
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
