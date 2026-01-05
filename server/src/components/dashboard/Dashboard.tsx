'use client';

import React, { useEffect } from 'react';
import Link from 'next/link';
import toast from 'react-hot-toast';
import { usePostHog } from 'posthog-js/react';
import { cn } from '../../lib/utils';
import { ReflectionContainer } from '../../types/ui-reflection/ReflectionContainer';
import { useAutomationIdAndRegister } from '../../types/ui-reflection/useAutomationIdAndRegister';
import type { ButtonComponent } from '../../types/ui-reflection/types';
import { usePerformanceTracking } from '../../lib/analytics/client';
import { Alert, AlertDescription } from '../ui/Alert';
import { Badge } from '../ui/Badge';
import { useOnboardingProgress, type OnboardingStep } from './hooks/useOnboardingProgress';
import {
  Ticket,
  BarChart3,
  Shield,
  HeartPulse,
  ClipboardList,
  Calendar,
  ArrowRight,
} from 'lucide-react';

const FeatureCard = ({ icon: Icon, title, description }: { icon: any; title: string; description: string }) => {
  const posthog = usePostHog();

  const handleHover = () => {
    posthog?.capture('feature_card_hovered', {
      feature_name: title.toLowerCase().replace(/\s+/g, '_'),
    });
  };

  return (
    <div
      className="rounded-lg border border-[rgb(var(--color-border-200))] bg-white hover:shadow-lg transition-shadow p-4"
      onMouseEnter={handleHover}
    >
      <div className="flex items-start space-x-4">
        <div className="p-2 rounded-lg" style={{ background: 'rgb(var(--color-primary-50))' }}>
          <Icon className="h-6 w-6" style={{ color: 'rgb(var(--color-primary-500))' }} />
        </div>
        <div>
          <h3 className="font-semibold mb-1" style={{ color: 'rgb(var(--color-text-900))' }}>
            {title}
          </h3>
          <p className="text-sm" style={{ color: 'rgb(var(--color-text-500))' }}>
            {description}
          </p>
        </div>
      </div>
    </div>
  );
};

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
      ? 'Just getting started! 🚀'
      : completed === total
        ? 'All set — great job! 🎉'
        : 'Keep going — you’ve got this! 💪';

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

const WelcomeDashboard = () => {
  const posthog = usePostHog();
  const { steps, summary, isLoading, hasResolved, error, refresh } = useOnboardingProgress();

  usePerformanceTracking('dashboard');

  useEffect(() => {
    posthog?.capture('dashboard_viewed', {
      dashboard_type: 'welcome',
      section_count: 3,
    });
    posthog?.capture('feature_discovered', {
      feature_name: 'dashboard_overview',
      discovery_method: 'navigation',
    });
  }, [posthog]);

  const handleOnboardingNavigate = (step: OnboardingStep, surface: 'quick_start' | 'checklist') => {
    posthog?.capture('onboarding_step_cta_clicked', {
      step_id: step.id,
      surface,
    });
  };

  return (
    <ReflectionContainer id="dashboard-main" label="MSP Dashboard">
      <div className="min-h-screen bg-slate-200/70 p-6">
        <div className="max-w-7xl mx-auto">
          <div className="space-y-8">
              <div>
                <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                  <div>
                    <h2 className="text-2xl font-bold tracking-tight text-slate-900">
                      Complete your setup
                    </h2>
                    <p className="mt-1 text-sm text-slate-600">
                      Work through each step to unlock the full MSP dashboard experience.
                    </p>
                  </div>
                  <ProgressSummaryCard completed={summary.completed} total={summary.total} />
                </div>
                {error && (
                  <Alert variant="destructive" className="mb-4">
                    <AlertDescription>
                      Unable to refresh onboarding status right now. {error.message}.{' '}
                      <button className="underline" onClick={() => refresh()}>
                        Try again
                      </button>
                    </AlertDescription>
                  </Alert>
                )}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {steps.map((step, index) => (
                    <QuickStartCard
                      key={step.id}
                      step={step}
                      index={index + 1}
                      onNavigate={(s) => handleOnboardingNavigate(s, 'quick_start')}
                      className={
                        steps.length % 2 === 1 && index === steps.length - 1
                          ? 'md:col-span-2 md:justify-self-center md:w-[560px]'
                          : undefined
                      }
                    />
                  ))}
                </div>
              </div>

              <div>
                <h2 className="text-xl font-semibold mb-4" style={{ color: 'rgb(var(--color-text-900))' }}>
                  Platform Features
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  <Link
                    href="/msp/tickets"
                    onClick={() =>
                      posthog?.capture('feature_accessed', {
                        feature_name: 'ticket_management',
                        access_method: 'dashboard_card',
                      })
                    }
                  >
                    <FeatureCard
                      icon={Ticket}
                      title="Ticket Management"
                      description="Streamline support with routing, SLA tracking, and guided workflows."
                    />
                  </Link>
                  <Link href="/msp/jobs">
                    <FeatureCard
                      icon={HeartPulse}
                      title="System Monitoring"
                      description="Watch critical signals across clients and trigger automation when needed."
                    />
                  </Link>
                  <Link href="/msp/security-settings">
                    <FeatureCard
                      icon={Shield}
                      title="Security Management"
                      description="Manage policies, approvals, and audit responses in one place."
                    />
                  </Link>
                  <Link href="/msp/projects">
                    <FeatureCard
                      icon={ClipboardList}
                      title="Project Management"
                      description="Organize delivery plans, tasks, and milestones for every engagement."
                    />
                  </Link>
                  <div onClick={() => toast.success('Coming soon!')} className="cursor-pointer">
                    <FeatureCard
                      icon={BarChart3}
                      title="Reporting & Analytics"
                      description="Build rollups on utilization, SLA attainment, and profitability."
                    />
                  </div>
                  <Link href="/msp/schedule">
                    <FeatureCard
                      icon={Calendar}
                      title="Schedule Management"
                      description="Coordinate onsite visits and remote sessions with bi-directional sync."
                    />
                  </Link>
                </div>
              </div>

              <div className="rounded-lg border border-dashed border-[rgb(var(--color-border-200))] bg-white p-4">
                <div className="flex flex-col md:flex-row items-center justify-between gap-4">
                  <div>
                    <h3 className="font-semibold mb-1" style={{ color: 'rgb(var(--color-text-900))' }}>
                      Need a deeper dive?
                    </h3>
                    <p className="text-sm" style={{ color: 'rgb(var(--color-text-500))' }}>
                      Explore deployment runbooks and best practices in the knowledge base.
                    </p>
                  </div>
                  <Link
                    href="https://www.nineminds.com/documentation"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-block px-4 py-2 rounded-md text-sm font-medium text-white bg-[rgb(var(--color-primary-500))] hover:bg-[rgb(var(--color-primary-600))] transition-colors"
                  >
                    Visit resources
                  </Link>
                </div>
              </div>
          </div>
        </div>
      </div>
    </ReflectionContainer>
  );
};

export default WelcomeDashboard;
