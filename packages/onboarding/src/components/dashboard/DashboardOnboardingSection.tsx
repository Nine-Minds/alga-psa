'use client';

import React, { useEffect, useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { usePostHog } from 'posthog-js/react';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { handleError } from '@alga-psa/ui/lib/errorHandling';
import { cn } from '@alga-psa/ui/lib';
import { useAutomationIdAndRegister } from '@alga-psa/ui/ui-reflection/useAutomationIdAndRegister';
import type { ButtonComponent } from '@alga-psa/ui/ui-reflection/types';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { Badge } from '@alga-psa/ui/components/Badge';
import { Progress } from '@alga-psa/ui/components/Progress';
import { STEP_DEFINITIONS, type StepDefinition } from '@alga-psa/onboarding/lib';
import {
  dismissDashboardOnboardingStep,
  restoreDashboardOnboardingStep,
  type OnboardingStepId,
  type OnboardingStepServerState,
} from '@alga-psa/onboarding/actions';
import { ArrowRight, CheckCircle2, Circle, EyeOff, RotateCcw, Sparkles } from 'lucide-react';

interface OnboardingProgressSummary {
  completed: number;
  total: number;
  remaining: number;
  allComplete: boolean;
}

interface DashboardOnboardingSectionProps {
  steps: OnboardingStepServerState[];
  className?: string;
  initialDismissedStepIds?: OnboardingStepId[];
}

interface OnboardingStep extends StepDefinition, OnboardingStepServerState {
  blocker: string | null;
  meta: Record<string, unknown>;
  dismissed: boolean;
  isActionable: boolean;
}

type DashboardTranslator = (key: string, options?: Record<string, unknown>) => string;
const EMPTY_DISMISSED_STEP_IDS: OnboardingStepId[] = [];

interface QuickStartCardProps {
  step: OnboardingStep;
  index: number;
  t: DashboardTranslator;
  onNavigate?: (step: OnboardingStep) => void;
  onDismiss?: (step: OnboardingStep) => void;
  isDismissing?: boolean;
  dismissDisabled?: boolean;
  className?: string;
}

const getQuickStartStatus = (
  t: DashboardTranslator
): Record<OnboardingStep['status'], { label: string; variant: import('@alga-psa/ui/components/Badge').BadgeVariant }> => ({
  not_started: {
    label: t('onboarding.badges.notStarted', { defaultValue: 'Not Started' }),
    variant: 'default',
  },
  in_progress: {
    label: t('onboarding.badges.inProgress', { defaultValue: 'In Progress' }),
    variant: 'secondary',
  },
  complete: {
    label: t('onboarding.badges.complete', { defaultValue: 'Complete' }),
    variant: 'success',
  },
  blocked: {
    label: t('onboarding.badges.blocked', { defaultValue: 'Blocked' }),
    variant: 'error',
  },
});

function ProgressRing({ value }: { value: number }) {
  const clamped = Math.max(0, Math.min(100, value));
  const size = 38;
  const stroke = 4;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference - (clamped / 100) * circumference;

  return (
    <div className="relative h-[38px] w-[38px] shrink-0">
      <svg width={size} height={size} className="rotate-[-90deg]">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          strokeWidth={stroke}
          className="fill-none stroke-muted"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          strokeWidth={stroke}
          strokeLinecap="round"
          className="fill-none stroke-primary"
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center text-[11px] font-semibold text-primary">
        {Math.round(clamped)}%
      </div>
    </div>
  );
}

function ProgressSummaryCard({
  completed,
  total,
  t,
}: {
  completed: number;
  total: number;
  t: DashboardTranslator;
}) {
  const safeTotal = Math.max(1, total);
  const percent = (completed / safeTotal) * 100;
  const isComplete = completed === total;
  const messageVariant =
    completed === 0
      ? 'default-muted'
      : isComplete
        ? 'success'
        : 'info';
  const message =
    completed === 0
      ? t('onboarding.progress.messageStart', { defaultValue: 'Just getting started!' })
      : isComplete
        ? t('onboarding.progress.messageComplete', { defaultValue: 'All set - great job!' })
        : t('onboarding.progress.messageInProgress', { defaultValue: "Keep going - you've got this!" });

  return (
    <div className="flex w-full max-w-[360px] items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-[0_2px_10px_rgba(15,23,42,0.06)]">
      <ProgressRing value={percent} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-3">
          <p className="text-[11px] font-semibold tracking-widest text-slate-500">
            {t('onboarding.progress.label', { defaultValue: 'PROGRESS' })}
          </p>
          <p className="text-xs font-semibold text-slate-700">
            {t('onboarding.progress.steps', {
              defaultValue: '{{completed}} of {{total}} Steps',
              completed,
              total,
            })}
          </p>
        </div>
        <Progress value={percent} max={100} size="sm" className="mt-2" />
        <Badge variant={messageVariant} size="sm" className="mt-2 w-fit">
          {message}
        </Badge>
      </div>
    </div>
  );
}

const QuickStartCard = ({
  step,
  index,
  t,
  onNavigate,
  onDismiss,
  isDismissing = false,
  dismissDisabled = false,
  className,
}: QuickStartCardProps) => {
  const { automationIdProps } = useAutomationIdAndRegister<ButtonComponent>({
    id: `quick-start-${step.id}`,
    type: 'button',
    label: `Step ${index}: ${step.title}`,
    variant: 'default',
    helperText: step.description,
  });
  const Icon = step.icon;
  const status = getQuickStartStatus(t)[step.status];
  const isDisabled = !step.isActionable;
  const isImportStep = step.id === 'data_import';

  const cardBody = (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-3 pr-20">
        <p className="text-[11px] font-semibold tracking-[0.2em] text-slate-500">
          {t('onboarding.stepLabel', { defaultValue: 'STEP {{index}}', index })}
        </p>
        <Badge variant={status.variant} size="sm" className="uppercase">
          {status.label}
        </Badge>
      </div>

      <div className="mt-4 flex items-start gap-4">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary-50 ring-1 ring-primary-100">
          <Icon className="h-5 w-5 text-primary-600" />
        </div>
        <div className="min-w-0">
          <h3 className="text-base font-semibold leading-6 text-slate-900">{step.title}</h3>
          <p className="mt-1 text-sm leading-5 text-slate-600">{step.description}</p>
          {isImportStep ? (
            <p className="mt-2 text-xs font-medium uppercase tracking-wide text-slate-500">
              {t('onboarding.substeps.dataImport', {
                defaultValue: 'Complete your first import OR create 5 contacts',
              })}
            </p>
          ) : null}
          {Array.isArray(step.substeps) && step.substeps.length > 0 ? (
            <ul className="mt-3 space-y-1.5">
              {step.substeps.map((substep) => (
                <li key={substep.id} className="flex items-center gap-2 text-xs text-slate-600">
                  {substep.status === 'complete' ? (
                    <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                  ) : (
                    <Circle className="h-4 w-4 text-slate-300" />
                  )}
                  <span className={substep.status === 'complete' ? 'text-slate-700' : undefined}>
                    {substep.title}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </div>

      {step.blocker ? (
        <Alert
          variant="destructive"
          className="mt-4 py-3"
        >
          <AlertDescription className="text-xs">{step.blocker}</AlertDescription>
        </Alert>
      ) : null}

      <div className="mt-auto" />

      <div className="mt-5 h-px w-full bg-slate-200/80" />

      <div
        className={cn(
          'mt-4 inline-flex w-fit items-center gap-1 text-sm font-semibold text-primary',
          isDisabled && 'text-slate-400'
        )}
      >
        <span className={cn(!isDisabled && 'group-hover:text-primary-700')}>
          {isDisabled
            ? t('onboarding.cta.completed', { defaultValue: 'Completed' })
            : step.ctaLabel}
        </span>
        <ArrowRight className={cn('h-4 w-4', !isDisabled && 'transition-transform group-hover:translate-x-0.5')} />
      </div>
    </div>
  );

  const hideLabel = isDismissing
    ? t('onboarding.cta.hiding', { defaultValue: 'Hiding...' })
    : t('onboarding.cta.hide', { defaultValue: 'Hide' });

  const dismissButton = (
    <button
      type="button"
      className="absolute right-4 top-4 z-10 inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-600 transition hover:border-slate-300 hover:text-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onDismiss?.(step);
      }}
      disabled={dismissDisabled}
      aria-label={t('onboarding.cta.dismiss', {
        defaultValue: 'Dismiss {{title}}',
        title: step.title,
      })}
      id={`dismiss-dashboard-onboarding-step-${step.id}`}
    >
      <EyeOff className="h-3.5 w-3.5" />
      {hideLabel}
    </button>
  );

  if (isDisabled) {
    return (
      <div className={cn('relative', className)}>
        {dismissButton}
        <div
          {...automationIdProps}
          className="rounded-xl border border-slate-200 bg-white p-6 opacity-60 shadow-[0_2px_10px_rgba(15,23,42,0.06)]"
          aria-disabled="true"
        >
          {cardBody}
        </div>
      </div>
    );
  }

  return (
    <div className={cn('relative', className)}>
      {dismissButton}
      <Link
        {...automationIdProps}
        href={step.ctaHref}
        className="group block rounded-xl border border-slate-200 bg-white p-6 shadow-[0_2px_10px_rgba(15,23,42,0.06)] transition hover:-translate-y-0.5 hover:shadow-md"
        onClick={() => onNavigate?.(step)}
      >
        {cardBody}
      </Link>
    </div>
  );
};

export default function DashboardOnboardingSection({
  steps: stepStates,
  className,
  initialDismissedStepIds = EMPTY_DISMISSED_STEP_IDS,
}: DashboardOnboardingSectionProps) {
  const { t } = useTranslation('msp/core');
  const posthog = usePostHog();
  const [dismissedStepIds, setDismissedStepIds] = useState<OnboardingStepId[]>(() =>
    getInitialDismissedStepIds(stepStates, initialDismissedStepIds)
  );
  const [activeStepId, setActiveStepId] = useState<OnboardingStepId | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    setDismissedStepIds(getInitialDismissedStepIds(stepStates, initialDismissedStepIds));
  }, [stepStates, initialDismissedStepIds]);

  const dismissedStepIdSet = useMemo(() => new Set<OnboardingStepId>(dismissedStepIds), [dismissedStepIds]);
  const steps = useMemo(() => enrichSteps(stepStates, dismissedStepIdSet), [stepStates, dismissedStepIdSet]);
  const visibleSteps = useMemo(() => steps.filter((step) => !step.dismissed), [steps]);
  const hiddenSteps = useMemo(() => steps.filter((step) => step.dismissed), [steps]);
  const translatedVisibleSteps = useMemo(
    () => visibleSteps.map((step) => translateOnboardingStep(step, t)),
    [visibleSteps, t]
  );
  const translatedHiddenSteps = useMemo(
    () => hiddenSteps.map((step) => translateOnboardingStep(step, t)),
    [hiddenSteps, t]
  );
  const summary = useMemo(() => buildSummary(steps), [steps]);
  const isOnboardingComplete = summary.allComplete;

  const handleDismiss = (step: OnboardingStep) => {
    if (isPending || dismissedStepIdSet.has(step.id)) {
      return;
    }

    const previousDismissedStepIds = dismissedStepIds;
    const nextDismissedStepIds = [...previousDismissedStepIds, step.id];

    setDismissedStepIds(nextDismissedStepIds);
    setActiveStepId(step.id);

    startTransition(async () => {
      try {
        const result = await dismissDashboardOnboardingStep(step.id);

        if (!result.success) {
          throw new Error(
            result.error
              || t('onboarding.errors.dismissFailed', {
                defaultValue: 'Failed to dismiss onboarding step.',
              })
          );
        }

        if (Array.isArray(result.data?.dismissedStepIds)) {
          setDismissedStepIds(result.data.dismissedStepIds);
        }

        posthog?.capture('onboarding_step_dismissed', {
          step_id: step.id,
          surface: 'quick_start',
        });
      } catch (error) {
        setDismissedStepIds(previousDismissedStepIds);
        handleError(
          error,
          t('onboarding.errors.dismissFailed', {
            defaultValue: 'Failed to dismiss onboarding step.',
          })
        );
      } finally {
        setActiveStepId(null);
      }
    });
  };

  const handleRestore = (step: OnboardingStep) => {
    if (isPending || !dismissedStepIdSet.has(step.id)) {
      return;
    }

    const previousDismissedStepIds = dismissedStepIds;
    const nextDismissedStepIds = previousDismissedStepIds.filter((id) => id !== step.id);

    setDismissedStepIds(nextDismissedStepIds);
    setActiveStepId(step.id);

    startTransition(async () => {
      try {
        const result = await restoreDashboardOnboardingStep(step.id);

        if (!result.success) {
          throw new Error(
            result.error
              || t('onboarding.errors.restoreFailed', {
                defaultValue: 'Failed to restore onboarding step.',
              })
          );
        }

        if (Array.isArray(result.data?.dismissedStepIds)) {
          setDismissedStepIds(result.data.dismissedStepIds);
        }

        posthog?.capture('onboarding_step_restored', {
          step_id: step.id,
          surface: 'quick_start',
        });
      } catch (error) {
        setDismissedStepIds(previousDismissedStepIds);
        handleError(
          error,
          t('onboarding.errors.restoreFailed', {
            defaultValue: 'Failed to restore onboarding step.',
          })
        );
      } finally {
        setActiveStepId(null);
      }
    });
  };

  const handleOnboardingNavigate = (step: OnboardingStep) => {
    posthog?.capture('onboarding_step_cta_clicked', {
      step_id: step.id,
      surface: 'quick_start',
    });
  };

  if (steps.length === 0) {
    return null;
  }

  return (
    <div className={className}>
      <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-2xl font-bold tracking-tight text-slate-900">
              {isOnboardingComplete
                ? t('onboarding.completeTitle', { defaultValue: 'Onboarding complete' })
                : t('onboarding.incompleteTitle', { defaultValue: 'Complete your setup' })}
            </h2>
            {isOnboardingComplete ? (
              <Badge className="border-emerald-500/30 bg-emerald-500/10 text-emerald-600 uppercase">
                <CheckCircle2 className="mr-1 h-3.5 w-3.5" />
                {t('onboarding.badges.complete', { defaultValue: 'Complete' })}
              </Badge>
            ) : null}
          </div>
          <p className="mt-1 text-sm text-slate-600">
            {isOnboardingComplete
              ? t('onboarding.completeDescription', {
                  defaultValue: "You're ready to use the full MSP dashboard experience.",
                })
              : t('onboarding.incompleteDescription', {
                  defaultValue: 'Work through each step to unlock the full MSP dashboard experience.',
                })}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/msp/onboarding"
            className="flex h-full items-center gap-2 rounded-xl border border-[rgb(var(--color-border-200))] bg-white px-4 py-3 text-sm font-semibold shadow-[0_2px_10px_rgba(15,23,42,0.06)] transition hover:-translate-y-0.5 hover:shadow-md"
            style={{ color: 'rgb(var(--color-text-700))' }}
          >
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full" style={{ background: 'rgb(var(--color-primary-50))' }}>
              <Sparkles className="h-4 w-4" style={{ color: 'rgb(var(--color-primary-500))' }} />
            </div>
            {t('dashboard.onboardingWizard')}
          </Link>
          <ProgressSummaryCard completed={summary.completed} total={summary.total} t={t} />
        </div>
      </div>
      {!isOnboardingComplete ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {translatedVisibleSteps.map((step, index) => (
            <QuickStartCard
              key={step.id}
              step={step}
              index={index + 1}
              t={t}
              onNavigate={handleOnboardingNavigate}
              onDismiss={handleDismiss}
              isDismissing={isPending && activeStepId === step.id}
              dismissDisabled={isPending}
              className={
                translatedVisibleSteps.length % 2 === 1 && index === translatedVisibleSteps.length - 1
                  ? 'md:col-span-2 md:justify-self-center md:w-[560px]'
                  : undefined
              }
            />
          ))}
        </div>
      ) : null}

      {hiddenSteps.length > 0 ? (
        <div className={cn('mt-6', visibleSteps.length > 0 && !isOnboardingComplete && 'pt-2')}>
          <HiddenStepsPanel
            steps={translatedHiddenSteps}
            t={t}
            onRestore={handleRestore}
            isPending={isPending}
            activeStepId={activeStepId}
          />
        </div>
      ) : null}
    </div>
  );
}

function HiddenStepsPanel({
  steps,
  t,
  onRestore,
  isPending,
  activeStepId,
}: {
  steps: OnboardingStep[];
  t: DashboardTranslator;
  onRestore: (step: OnboardingStep) => void;
  isPending: boolean;
  activeStepId: OnboardingStepId | null;
}) {
  return (
    <div className="rounded-xl border border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-border-50))] p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-semibold text-[rgb(var(--color-text-800))]">
          {t('onboarding.hidden.title', {
            defaultValue: 'Hidden setup cards ({{count}})',
            count: steps.length,
          })}
        </p>
        <p className="text-xs text-[rgb(var(--color-text-500))]">
          {t('onboarding.hidden.subtitle', {
            defaultValue: 'Restore any card if you need it later.',
          })}
        </p>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {steps.map((step) => (
          <button
            key={step.id}
            type="button"
            className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 transition hover:border-slate-300 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-60"
            onClick={() => onRestore(step)}
            disabled={isPending}
            id={`restore-dashboard-onboarding-step-${step.id}`}
          >
            <RotateCcw className="h-3.5 w-3.5" />
            {isPending && activeStepId === step.id
              ? t('onboarding.cta.restoring', { defaultValue: 'Restoring...' })
              : step.title}
          </button>
        ))}
      </div>
    </div>
  );
}

function getInitialDismissedStepIds(
  stepStates: OnboardingStepServerState[],
  initialDismissedStepIds: OnboardingStepId[]
): OnboardingStepId[] {
  const dismissedFromStepState = stepStates
    .filter((step) => step.dismissed)
    .map((step) => step.id);

  return Array.from(new Set<OnboardingStepId>([...initialDismissedStepIds, ...dismissedFromStepState]));
}

function buildSummary(steps: OnboardingStep[]): OnboardingProgressSummary {
  const completed = steps.filter((step) => step.status === 'complete').length;
  const total = steps.length;

  return {
    completed,
    total,
    remaining: Math.max(0, total - completed),
    allComplete: total > 0 && completed === total,
  };
}

function enrichSteps(
  stepStates: OnboardingStepServerState[],
  dismissedStepIds: Set<OnboardingStepId>
): OnboardingStep[] {
  const stateById = new Map<OnboardingStepId, OnboardingStepServerState>(
    stepStates.map((state) => [state.id, state])
  );

  return Object.values(STEP_DEFINITIONS).map((definition) => {
    const state = stateById.get(definition.id);
    const isDismissed = dismissedStepIds.has(definition.id) || state?.dismissed === true;
    const status = isDismissed ? 'complete' : (state?.status ?? 'not_started');

    return {
      ...definition,
      status,
      lastUpdated: state?.lastUpdated ?? null,
      blocker: isDismissed ? null : (state?.blocker ?? null),
      blockerKey: isDismissed ? null : (state?.blockerKey ?? null),
      blockerValues: isDismissed ? undefined : state?.blockerValues,
      progressValue: isDismissed ? 100 : (state?.progressValue ?? null),
      meta: state?.meta ?? {},
      substeps: state?.substeps ?? [],
      dismissed: isDismissed,
      isActionable: status !== 'complete',
    } satisfies OnboardingStep;
  });
}

function translateOnboardingStep(step: OnboardingStep, t: DashboardTranslator): OnboardingStep {
  return {
    ...step,
    title: t(step.titleKey, { defaultValue: step.title }),
    description: t(step.descriptionKey, { defaultValue: step.description }),
    ctaLabel: t(step.ctaLabelKey, { defaultValue: step.ctaLabel }),
    blocker: step.blockerKey
      ? t(step.blockerKey, { defaultValue: step.blocker ?? step.blockerKey, ...step.blockerValues })
      : step.blocker,
    substeps: step.substeps?.map((substep) => ({
      ...substep,
      title: substep.titleKey
        ? t(substep.titleKey, { defaultValue: substep.title })
        : substep.title,
      blocker: substep.blockerKey
        ? t(substep.blockerKey, { defaultValue: substep.blocker ?? substep.blockerKey, ...substep.blockerValues })
        : substep.blocker,
    })) ?? [],
  };
}
