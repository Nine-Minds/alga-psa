import type {
  DiagnosticsErrorMeta,
  DiagnosticsHttpMeta,
  DiagnosticsStepStatus,
  DiagnosticsRecommendation,
  EntraDiagnosticsStep,
} from '@alga-psa/types';
import { classifyGraphFailure } from '@alga-psa/shared/services/diagnostics';

export interface EntraStepOutcome {
  status: DiagnosticsStepStatus;
  http?: DiagnosticsHttpMeta;
  data?: Record<string, unknown>;
  error?: DiagnosticsErrorMeta;
  recommendations?: DiagnosticsRecommendation[];
}

export interface EntraStepOptions {
  /** Step ids that must not fail/skip before this step may run. */
  requires?: string[];
  /** Reason shown when the step is intentionally skipped. */
  skipReason?: string;
}

export interface EntraStepRunner {
  steps: EntraDiagnosticsStep[];
  statuses: Map<string, DiagnosticsStepStatus>;
  runStep: (
    id: string,
    title: string,
    options: EntraStepOptions,
    fn: () => Promise<EntraStepOutcome>
  ) => Promise<EntraDiagnosticsStep>;
}

/**
 * Dependency-aware Entra step runner. A failed prerequisite produces a `skip`
 * step with `blockedBy`, but independent steps continue to run. Unexpected
 * errors are classified with the shared Graph classifier so correlation ids
 * survive.
 */
export function createEntraStepRunner(): EntraStepRunner {
  const steps: EntraDiagnosticsStep[] = [];
  const statuses = new Map<string, DiagnosticsStepStatus>();

  const runStep: EntraStepRunner['runStep'] = async (id, title, options, fn) => {
    const blockedBy = (options.requires ?? []).find((required) => {
      const status = statuses.get(required);
      return status === 'fail' || status === 'skip';
    });

    if (blockedBy) {
      const step: EntraDiagnosticsStep = {
        id,
        title,
        status: 'skip',
        startedAt: new Date().toISOString(),
        durationMs: 0,
        blockedBy,
        data: options.skipReason ? { reason: options.skipReason } : undefined,
      };
      steps.push(step);
      statuses.set(id, 'skip');
      return step;
    }

    const stepStarted = Date.now();
    const startedAt = new Date().toISOString();
    try {
      const partial = await fn();
      const step: EntraDiagnosticsStep = {
        id,
        title,
        startedAt,
        durationMs: Date.now() - stepStarted,
        status: partial.status,
        http: partial.http,
        data: partial.data,
        error: partial.error,
        recommendations: partial.recommendations,
      };
      steps.push(step);
      statuses.set(id, step.status);
      return step;
    } catch (error: unknown) {
      const classified = classifyGraphFailure(error);
      const errorMeta: DiagnosticsErrorMeta = {
        message: classified.message,
        status: classified.status,
        code: classified.code,
        requestId: classified.requestId,
        clientRequestId: classified.clientRequestId,
        responseBody: classified.responseBody,
      };
      const step: EntraDiagnosticsStep = {
        id,
        title,
        startedAt,
        durationMs: Date.now() - stepStarted,
        status: 'fail',
        error: errorMeta,
      };
      steps.push(step);
      statuses.set(id, 'fail');
      return step;
    }
  };

  return { steps, statuses, runStep };
}
