import DashboardOnboardingSection from './DashboardOnboardingSection';
import { getOnboardingProgressAction } from '@alga-psa/onboarding/actions';
import type { OnboardingStepServerState } from '@alga-psa/onboarding/actions';

interface OnboardingProgressSummary {
  completed: number;
  total: number;
  remaining: number;
  allComplete: boolean;
}

export async function DashboardOnboardingSlot() {
  try {
    const onboardingProgress = await getOnboardingProgressAction();
    const summary = buildSummary(onboardingProgress.steps);

    const className = summary.allComplete ? 'order-last' : undefined;

    return (
      <DashboardOnboardingSection
        steps={onboardingProgress.steps}
        summary={summary}
        className={className}
      />
    );
  } catch (error) {
    console.error('Failed to load onboarding progress for dashboard:', error);
    return null;
  }
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
