import DashboardOnboardingSection from './DashboardOnboardingSection';
import {
  getDismissedDashboardOnboardingSteps,
  getOnboardingProgressAction,
  getDashboardOnboardingSectionDismissedAction,
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
    const [onboardingProgress, dismissedStepIds, sectionDismissal] = await Promise.all([
      getOnboardingProgressAction(),
      getDismissedDashboardOnboardingSteps(),
      getDashboardOnboardingSectionDismissedAction().catch((error) => {
        console.error('Failed to load dashboard onboarding section preference:', error);
        return { success: false as const };
      }),
    ]);
    const steps = applyDismissedState(onboardingProgress.steps, dismissedStepIds);
    const summary = buildSummary(steps);
    if (shouldHideCompletedOnboardingSection(summary.allComplete, sectionDismissal.success && sectionDismissal.data?.dismissed === true)) return null;

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

export function shouldHideCompletedOnboardingSection(allComplete: boolean, sectionDismissed: boolean): boolean {
  return allComplete && sectionDismissed;
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
