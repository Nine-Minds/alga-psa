'use client';

import { useEffect, useMemo, useRef } from 'react';
import useSWR from 'swr';
import { usePostHog } from 'posthog-js/react';
import { STEP_DEFINITIONS, type StepDefinition } from '@/lib/onboarding/stepDefinitions';
import {
  getOnboardingProgressAction,
  type OnboardingProgressResponse,
  type OnboardingStepServerState,
  type OnboardingStepStatus,
  type OnboardingStepId,
} from '@/lib/actions/onboarding-progress';

const REFRESH_INTERVAL_MS = 60_000;

export interface OnboardingStep extends StepDefinition, OnboardingStepServerState {
  blocker: string | null;
  meta: Record<string, unknown>;
  isActionable: boolean;
}

export interface OnboardingProgressSummary {
  completed: number;
  total: number;
  remaining: number;
  allComplete: boolean;
}

export interface UseOnboardingProgressResult {
  steps: OnboardingStep[];
  stepsById: Record<OnboardingStepId, OnboardingStep>;
  summary: OnboardingProgressSummary;
  isLoading: boolean;
  hasResolved: boolean;
  error: Error | undefined;
  refresh: () => Promise<OnboardingProgressResponse | undefined>;
}

interface UseOnboardingProgressOptions {
  initialData?: OnboardingProgressResponse;
}

const fetchOnboardingProgress = async (): Promise<OnboardingProgressResponse> => {
  return getOnboardingProgressAction();
};

export function useOnboardingProgress(options?: UseOnboardingProgressOptions): UseOnboardingProgressResult {
  const posthog = usePostHog();
  const previousStatuses = useRef<Record<OnboardingStepId, OnboardingStepStatus>>({
    identity_sso: 'not_started',
    client_portal_domain: 'not_started',
    data_import: 'not_started',
    calendar_sync: 'not_started',
    managed_email: 'not_started',
  });

  const { data, error, isLoading, mutate } = useSWR<OnboardingProgressResponse>(
    'onboarding-progress',
    fetchOnboardingProgress,
    {
      fallbackData: options?.initialData,
      refreshInterval: REFRESH_INTERVAL_MS,
      revalidateOnFocus: true,
    },
  );

  const typedError = error as Error | undefined;

  const steps = useMemo(() => enrichSteps(data?.steps), [data?.steps]);

  useEffect(() => {
    if (!steps.length) {
      return;
    }

    steps.forEach((step) => {
      const previousStatus = previousStatuses.current[step.id];
      if (step.status === 'complete' && previousStatus !== 'complete') {
        posthog?.capture('onboarding_step_completed', {
          step_id: step.id,
        });
      }
      previousStatuses.current[step.id] = step.status;
    });
  }, [steps, posthog]);

  const stepsById = useMemo(() => {
    return steps.reduce<Record<OnboardingStepId, OnboardingStep>>((acc, step) => {
      acc[step.id] = step;
      return acc;
    }, {} as Record<OnboardingStepId, OnboardingStep>);
  }, [steps]);

  const summary = useMemo<OnboardingProgressSummary>(() => {
    const completed = steps.filter((step) => step.status === 'complete').length;
    const total = steps.length;
    return {
      completed,
      total,
      remaining: Math.max(0, total - completed),
      allComplete: total > 0 && completed === total,
    };
  }, [steps]);

  return {
    steps,
    stepsById,
    summary,
    isLoading,
    hasResolved: Boolean(data),
    error: typedError,
    refresh: () => mutate(),
  };
}

function enrichSteps(stepStates?: OnboardingStepServerState[]): OnboardingStep[] {
  const stateById = new Map<OnboardingStepId, OnboardingStepServerState>(
    (stepStates ?? []).map((state) => [state.id, state]),
  );

  return Object.values(STEP_DEFINITIONS).map((definition) => {
    const state = stateById.get(definition.id);

    return {
      ...definition,
      status: state?.status ?? 'not_started',
      lastUpdated: state?.lastUpdated ?? null,
      blocker: state?.blocker ?? null,
      progressValue: state?.progressValue ?? null,
      meta: state?.meta ?? {},
      isActionable: state?.status !== 'complete',
    } satisfies OnboardingStep;
  });
}
