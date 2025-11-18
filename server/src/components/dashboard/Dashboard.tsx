'use client';

import React, { useEffect } from 'react';
import Link from 'next/link';
import toast from 'react-hot-toast';
import { usePostHog } from 'posthog-js/react';
import { ReflectionContainer } from '../../types/ui-reflection/ReflectionContainer';
import { useAutomationIdAndRegister } from '../../types/ui-reflection/useAutomationIdAndRegister';
import type { ButtonComponent } from '../../types/ui-reflection/types';
import { usePerformanceTracking } from '../../lib/analytics/client';
import { Alert, AlertDescription } from '../ui/Alert';
import { Badge } from '../ui/Badge';
import { OnboardingChecklist } from './OnboardingChecklist';
import { useOnboardingProgress, type OnboardingStep } from './hooks/useOnboardingProgress';
import {
  Ticket,
  BarChart3,
  Shield,
  HeartPulse,
  ClipboardList,
  Calendar,
  ChevronRight,
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
}

const quickStartStatus: Record<OnboardingStep['status'], { label: string; badgeVariant: 'secondary' | 'primary' | 'success' | 'error' }> = {
  not_started: { label: 'Not started', badgeVariant: 'secondary' },
  in_progress: { label: 'In progress', badgeVariant: 'primary' },
  complete: { label: 'Complete', badgeVariant: 'success' },
  blocked: { label: 'Blocked', badgeVariant: 'error' },
};

const QuickStartCard = ({ step, index, onNavigate }: QuickStartCardProps) => {
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
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between text-xs uppercase tracking-wide text-muted-foreground">
        <span>Step {index}</span>
        <Badge variant={status.badgeVariant}>{status.label}</Badge>
      </div>
      <div className="flex items-start gap-3">
        <div className="rounded-full bg-primary-50 p-3">
          <Icon className="h-5 w-5 text-primary-700" />
        </div>
        <div>
          <h3 className="text-base font-semibold text-foreground">{step.title}</h3>
          <p className="text-sm text-muted-foreground">{step.description}</p>
          {step.blocker && (
            <p className="mt-2 text-xs text-amber-600">{step.blocker}</p>
          )}
        </div>
      </div>
      <div className="flex items-center justify-between text-sm font-medium text-primary-600">
        <span>{isDisabled ? 'Complete' : step.ctaLabel}</span>
        <ChevronRight className="h-4 w-4" />
      </div>
    </div>
  );

  if (isDisabled) {
    return (
      <div
        {...automationIdProps}
        className="rounded-lg border border-border bg-white/80 p-4 opacity-60"
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
      className="rounded-lg border border-border bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-lg"
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
      <div className="p-6 min-h-screen" style={{ background: 'rgb(var(--background))' }}>
        <div className="max-w-7xl mx-auto">
          <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
            <div className="order-2 xl:order-1 space-y-8">
              <div
                className="rounded-lg p-6"
                style={{ background: 'linear-gradient(to right, rgb(var(--color-primary-500)), rgb(var(--color-secondary-500)))' }}
              >
                <div className="max-w-4xl">
                  <h1 className="text-3xl font-bold mb-2 text-white">Welcome to Your MSP Command Center</h1>
                  <p className="text-lg text-white opacity-90">
                    Track onboarding progress, configure critical services, and keep every client experience consistent.
                  </p>
                </div>
              </div>

              <div>
                <div className="mb-4 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                  <div>
                    <h2 className="text-xl font-semibold" style={{ color: 'rgb(var(--color-text-900))' }}>
                      Complete your setup
                    </h2>
                    <p className="text-sm" style={{ color: 'rgb(var(--color-text-500))' }}>
                      Work through each step to unlock the full MSP dashboard experience.
                    </p>
                  </div>
                  <Badge variant="outline">{summary.completed} / {summary.total} done</Badge>
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

            <div className="order-1 xl:order-2 xl:pl-4">
              <OnboardingChecklist
                steps={steps}
                summary={summary}
                isLoading={!hasResolved && isLoading}
                onStepCta={(step) => handleOnboardingNavigate(step, 'checklist')}
              />
            </div>
          </div>
        </div>
      </div>
    </ReflectionContainer>
  );
};

export default WelcomeDashboard;
