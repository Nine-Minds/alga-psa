export type OnboardingProgressStatus = 'not_started' | 'in_progress' | 'blocked' | 'complete';

export interface OnboardingProgressSubstep {
  id: string;
  title: string;
  status: OnboardingProgressStatus;
  lastUpdated: string | null;
  blocker?: string | null;
  meta?: Record<string, unknown>;
}

export interface DerivedParentProgress {
  status: OnboardingProgressStatus;
  blocker: string | null;
  lastUpdated: string | null;
  progressValue: number;
}

const parseIso = (value: string | null | undefined): number | null => {
  if (!value) {
    return null;
  }
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? null : parsed;
};

const maxIso = (values: Array<string | null | undefined>): string | null => {
  let best: { iso: string; ts: number } | null = null;
  for (const iso of values) {
    const ts = parseIso(iso);
    if (ts === null) {
      continue;
    }
    if (!best || ts > best.ts) {
      best = { iso, ts } as { iso: string; ts: number };
    }
  }
  return best?.iso ?? null;
};

export function deriveParentStepFromSubsteps(
  substeps: OnboardingProgressSubstep[],
  fallbackLastUpdated: string | null = null,
): DerivedParentProgress {
  if (!Array.isArray(substeps) || substeps.length === 0) {
    return {
      status: 'not_started',
      blocker: null,
      lastUpdated: fallbackLastUpdated,
      progressValue: 0,
    };
  }

  const hasBlocked = substeps.some((substep) => substep.status === 'blocked');
  if (hasBlocked) {
    const blocker = substeps.find((substep) => substep.status === 'blocked')?.blocker ?? null;
    return {
      status: 'blocked',
      blocker,
      lastUpdated: maxIso([fallbackLastUpdated, ...substeps.map((substep) => substep.lastUpdated)]),
      progressValue: Math.round((substeps.filter((substep) => substep.status === 'complete').length / substeps.length) * 100),
    };
  }

  const completed = substeps.filter((substep) => substep.status === 'complete').length;
  if (completed === substeps.length) {
    return {
      status: 'complete',
      blocker: null,
      lastUpdated: maxIso([fallbackLastUpdated, ...substeps.map((substep) => substep.lastUpdated)]),
      progressValue: 100,
    };
  }

  const started = substeps.some((substep) => substep.status === 'in_progress' || substep.status === 'complete');
  return {
    status: started ? 'in_progress' : 'not_started',
    blocker: null,
    lastUpdated: maxIso([fallbackLastUpdated, ...substeps.map((substep) => substep.lastUpdated)]),
    progressValue: Math.round((completed / substeps.length) * 100),
  };
}

