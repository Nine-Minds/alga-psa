import DashboardOnboardingSection from './DashboardOnboardingSection';
import {
  getDismissedDashboardOnboardingSteps,
  getOnboardingProgressAction,
} from '@alga-psa/onboarding/actions';
import type { OnboardingStepId, OnboardingStepServerState } from '@alga-psa/onboarding/actions';

interface OnboardingProgressSummary {
  completed: number;
  total: number;
  remaining: number;
  allComplete: boolean;
}

export async function DashboardOnboardingSlot() {
  try {
    const [onboardingProgress, dismissedStepIds] = await Promise.all([
      getOnboardingProgressAction(),
      getDismissedDashboardOnboardingSteps(),
    ]);
    const steps = applyDismissedState(onboardingProgress.steps, dismissedStepIds);
    const summary = buildSummary(steps);

    const className = summary.allComplete ? 'order-last' : undefined;

    return (
      <DashboardOnboardingSection
        steps={steps}
        initialDismissedStepIds={dismissedStepIds}
        className={className}
      />
    );
  } catch (error) {
    console.error('Failed to load onboarding progress for dashboard:', error);
    return null;
  }
}

function applyDismissedState(
  steps: OnboardingStepServerState[],
  dismissedStepIds: OnboardingStepId[]
): OnboardingStepServerState[] {
  const dismissedSet = new Set<OnboardingStepId>(dismissedStepIds);

  return steps.map((step) => {
    if (!dismissedSet.has(step.id)) {
      return {
        ...step,
        dismissed: false,
      };
    }

    return {
      ...step,
      dismissed: true,
      status: 'complete',
      blocker: null,
    };
  });
}

function buildSummary(steps: OnboardingStepServerState[]): OnboardingProgressSummary {
  const completed = steps.filter((step) => step.status === 'complete').length;
  const total = steps.length;

  return {
    completed,
    total,
    remaining: Math.max(0, total - completed),
    allComplete: total > 0 && completed === total,
  };
}
