import type {
  DiagnosticsErrorMeta,
  DiagnosticsHttpMeta,
  DiagnosticsRecommendation,
  DiagnosticsStepStatus,
  EntraDiagnosticsStep,
} from '@alga-psa/types';
import {
  classifyGraphFailure,
  createDiagnosticsRunner,
} from '@alga-psa/shared/services/diagnostics';
import { classifyEntraOAuthFailure } from './oauthClassifier';

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
 * Dependency-aware Entra step runner. It composes the shared timed runner for
 * timing/error capture and adds only the Entra-specific behavior: dependency
 * skips with `blockedBy`, structured recommendations, and OAuth-aware
 * classification of thrown errors.
 */
export function createEntraStepRunner(): EntraStepRunner {
  const recommendationsById = new Map<string, DiagnosticsRecommendation[]>();

  const shared = createDiagnosticsRunner({
    classifyError: (error): DiagnosticsErrorMeta => {
      const failure = classifyGraphFailure(error);
      return {
        message: failure.message,
        status: failure.status,
        code: failure.code,
        requestId: failure.requestId,
        clientRequestId: failure.clientRequestId,
        responseBody: failure.responseBody,
      };
    },
    onError: (error, stepId) => {
      const classified = classifyEntraOAuthFailure({
        message: (error as any)?.message,
        httpStatus: (error as any)?.response?.status,
        code: (error as any)?.code,
        responseBody: (error as any)?.response?.data,
        context: 'partner',
      });
      if (classified.recommendation) {
        recommendationsById.set(stepId, [
          ...(recommendationsById.get(stepId) ?? []),
          classified.recommendation,
        ]);
      }
    },
  });

  const steps = shared.steps;
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
      shared.push(step);
      statuses.set(id, 'skip');
      return step;
    }

    const step = await shared.runStep(id, title, async () => {
      const outcome = await fn();
      if (outcome.recommendations?.length) {
        recommendationsById.set(id, outcome.recommendations);
      }
      const { recommendations: _recommendations, ...partial } = outcome;
      return partial;
    });

    const enriched = step as EntraDiagnosticsStep;
    const collected = recommendationsById.get(id);
    if (collected?.length) {
      enriched.recommendations = collected;
    }
    statuses.set(id, step.status);
    return enriched;
  };

  return { steps, statuses, runStep };
}
