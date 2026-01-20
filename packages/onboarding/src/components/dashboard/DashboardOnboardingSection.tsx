'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { usePostHog } from 'posthog-js/react';
import { cn } from '@alga-psa/ui/lib';
import { useAutomationIdAndRegister } from '@alga-psa/ui/ui-reflection/useAutomationIdAndRegister';
import type { ButtonComponent } from '@alga-psa/ui/ui-reflection/types';
import { Badge } from '@alga-psa/ui/components/Badge';
import { STEP_DEFINITIONS, type StepDefinition } from '@alga-psa/onboarding/lib';
import type { OnboardingStepId, OnboardingStepServerState } from '@alga-psa/onboarding/actions';
import { ArrowRight, CheckCircle2, Circle } from 'lucide-react';

interface OnboardingProgressSummary {
  completed: number;
  total: number;
  remaining: number;
  allComplete: boolean;
}

interface DashboardOnboardingSectionProps {
  steps: OnboardingStepServerState[];
  summary: OnboardingProgressSummary;
  className?: string;
}

interface OnboardingStep extends StepDefinition, OnboardingStepServerState {
  blocker: string | null;
  meta: Record<string, unknown>;
  isActionable: boolean;
}

interface QuickStartCardProps {
  step: OnboardingStep;
  index: number;
  onNavigate?: (step: OnboardingStep) => void;
  className?: string;
}

const quickStartStatus: Record<OnboardingStep['status'], { label: string; className: string }> = {
  not_started: { label: 'NOT STARTED', className: 'border-transparent bg-slate-100 text-slate-600' },
  in_progress: { label: 'IN PROGRESS', className: 'border-transparent bg-slate-100 text-slate-600' },
  complete: { label: 'COMPLETE', className: 'border-transparent bg-slate-100 text-slate-600' },
  blocked: { label: 'BLOCKED', className: 'border-transparent bg-red-100 text-red-700' },
};

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
          className="fill-none stroke-slate-200"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          strokeWidth={stroke}
          strokeLinecap="round"
          className="fill-none stroke-violet-500"
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center text-[11px] font-semibold text-violet-600">
        {Math.round(clamped)}%
      </div>
    </div>
  );
}

function ProgressSummaryCard({ completed, total }: { completed: number; total: number }) {
  const safeTotal = Math.max(1, total);
  const percent = (completed / safeTotal) * 100;
  const message =
    completed === 0
      ? 'Just getting started!'
      : completed === total
        ? 'All set - great job!'
        : 'Keep going - you\'ve got this!';

  return (
    <div className="flex w-full max-w-[360px] items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-[0_2px_10px_rgba(15,23,42,0.06)]">
      <ProgressRing value={percent} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-3">
          <p className="text-[11px] font-semibold tracking-widest text-slate-500">PROGRESS</p>
          <p className="text-xs font-semibold text-slate-700">
            {completed} of {total} Steps
          </p>
        </div>
        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
          <div
            className="h-full rounded-full bg-violet-500"
            style={{ width: `${Math.max(2, Math.min(100, percent))}%` }}
          />
        </div>
        <p className="mt-1 text-xs font-medium text-orange-600">{message}</p>
      </div>
    </div>
  );
}

const QuickStartCard = ({ step, index, onNavigate, className }: QuickStartCardProps) => {
  const { automationIdProps } = useAutomationIdAndRegister<ButtonComponent>({
    id: `quick-start-${step.id}`,
    type: 'button',
    label: `Step ${index}: ${step.title}`,
    variant: 'default',
    helperText: step.description,
  });
  const Icon = step.icon;
  const status = quickStartStatus[step.status];
  const isDisabled = !step.isActionable;
  const isImportStep = step.id === 'data_import';

  const cardBody = (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[11px] font-semibold tracking-[0.2em] text-slate-500">STEP {index}</p>
        <Badge
          className={cn(
            'h-5 rounded-full px-2 text-[10px] font-semibold uppercase tracking-wide',
            status.className
          )}
        >
          {status.label}
        </Badge>
      </div>

      <div className="mt-4 flex items-start gap-4">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-violet-50 ring-1 ring-violet-100">
          <Icon className="h-5 w-5 text-violet-600" />
        </div>
        <div className="min-w-0">
          <h3 className="text-base font-semibold leading-6 text-slate-900">{step.title}</h3>
          <p className="mt-1 text-sm leading-5 text-slate-600">{step.description}</p>
          {isImportStep ? (
            <p className="mt-2 text-xs font-medium uppercase tracking-wide text-slate-500">
              Complete your first import OR create 5 contacts
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
        <div
          className={cn(
            'mt-4 rounded-md border px-3 py-2 text-xs font-medium leading-5',
            step.status === 'blocked'
              ? 'border-red-100 bg-red-50 text-red-700'
              : 'border-orange-100 bg-orange-50 text-orange-700'
          )}
        >
          {step.blocker}
        </div>
      ) : null}

      <div className="mt-auto" />

      <div className="mt-5 h-px w-full bg-slate-200/80" />

      <div
        className={cn(
          'mt-4 inline-flex w-fit items-center gap-1 text-sm font-semibold text-violet-600',
          isDisabled && 'text-slate-400'
        )}
      >
        <span className={cn(!isDisabled && 'group-hover:text-violet-700')}>
          {isDisabled ? 'Completed' : step.ctaLabel}
        </span>
        <ArrowRight className={cn('h-4 w-4', !isDisabled && 'transition-transform group-hover:translate-x-0.5')} />
      </div>
    </div>
  );

  if (isDisabled) {
    return (
      <div
        {...automationIdProps}
        className={cn(
          'rounded-xl border border-slate-200 bg-white p-6 opacity-60 shadow-[0_2px_10px_rgba(15,23,42,0.06)]',
          className
        )}
        aria-disabled="true"
      >
        {cardBody}
      </div>
    );
  }

  return (
    <Link
      {...automationIdProps}
      href={step.ctaHref}
      className={cn(
        'group rounded-xl border border-slate-200 bg-white p-6 shadow-[0_2px_10px_rgba(15,23,42,0.06)] transition hover:-translate-y-0.5 hover:shadow-md',
        className
      )}
      onClick={() => onNavigate?.(step)}
    >
      {cardBody}
    </Link>
  );
};

export default function DashboardOnboardingSection({
  steps: stepStates,
  summary,
  className,
}: DashboardOnboardingSectionProps) {
  const posthog = usePostHog();
  const steps = useMemo(() => enrichSteps(stepStates), [stepStates]);

  if (steps.length === 0) {
    return null;
  }

  const isOnboardingComplete = summary.allComplete;

  const handleOnboardingNavigate = (step: OnboardingStep) => {
    posthog?.capture('onboarding_step_cta_clicked', {
      step_id: step.id,
      surface: 'quick_start',
    });
  };

  return (
    <div className={className}>
      <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-2xl font-bold tracking-tight text-slate-900">
              {isOnboardingComplete ? 'Onboarding complete' : 'Complete your setup'}
            </h2>
            {isOnboardingComplete ? (
              <Badge className="border-emerald-200 bg-emerald-50 text-emerald-700">
                <CheckCircle2 className="mr-1 h-3.5 w-3.5" />
                Complete
              </Badge>
            ) : null}
          </div>
          <p className="mt-1 text-sm text-slate-600">
            {isOnboardingComplete
              ? "You're ready to use the full MSP dashboard experience."
              : 'Work through each step to unlock the full MSP dashboard experience.'}
          </p>
        </div>
        <ProgressSummaryCard completed={summary.completed} total={summary.total} />
      </div>
      {!isOnboardingComplete ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {steps.map((step, index) => (
            <QuickStartCard
              key={step.id}
              step={step}
              index={index + 1}
              onNavigate={handleOnboardingNavigate}
              className={
                steps.length % 2 === 1 && index === steps.length - 1
                  ? 'md:col-span-2 md:justify-self-center md:w-[560px]'
                  : undefined
              }
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function enrichSteps(stepStates: OnboardingStepServerState[]): OnboardingStep[] {
  const stateById = new Map<OnboardingStepId, OnboardingStepServerState>(
    stepStates.map((state) => [state.id, state])
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
      substeps: state?.substeps ?? [],
      isActionable: state?.status !== 'complete',
    } satisfies OnboardingStep;
  });
}
