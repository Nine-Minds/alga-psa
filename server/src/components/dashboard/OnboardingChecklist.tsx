'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { CheckCircle2, Circle, AlertCircle, Sparkles } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/Card';
import { Button } from '../ui/Button';
import { Badge, type BadgeVariant } from '../ui/Badge';
import { Progress } from '../ui/Progress';
import { Alert, AlertDescription } from '../ui/Alert';
import { Skeleton } from '../ui/Skeleton';
import Drawer from '../ui/Drawer';
import type { OnboardingProgressSummary, OnboardingStep } from './hooks/useOnboardingProgress';

interface OnboardingChecklistProps {
  steps: OnboardingStep[];
  summary: OnboardingProgressSummary;
  isLoading?: boolean;
  onStepCta?: (step: OnboardingStep) => void;
}

export function OnboardingChecklist({ steps, summary, isLoading, onStepCta }: OnboardingChecklistProps) {
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);

  const content = useMemo(() => (
    <Card className="shadow-md">
      <CardHeader className="space-y-1">
        <CardTitle className="text-lg font-semibold">Onboarding checklist</CardTitle>
        <p className="text-sm text-muted-foreground">
          {summary.completed} of {summary.total} tasks complete
        </p>
        <Progress value={(summary.completed / Math.max(summary.total, 1)) * 100} className="h-2" />
        {summary.allComplete && (
          <div className="mt-4 rounded-md bg-primary-50 p-3 text-sm text-primary-900 flex items-start gap-2">
            <Sparkles className="h-5 w-5" />
            <div>
              <p className="font-medium">Configuration complete</p>
              <p>Invite clients to experience your branded portal.</p>
              <Button id="invite-clients-onboarding-button" asChild size="sm" className="mt-3">
                <Link href="/msp/clients?create=true">Invite clients</Link>
              </Button>
            </div>
          </div>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading && steps.length === 0 ? (
          <ChecklistSkeleton />
        ) : (
          steps.map((step) => (
            <StepItem key={step.id} step={step} onCtaClick={onStepCta} />
          ))
        )}
      </CardContent>
    </Card>
  ), [steps, summary, isLoading, onStepCta]);

  return (
    <div>
      <div className="mb-4 lg:hidden">
        <Button id="open-onboarding-checklist-drawer" variant="outline" className="w-full" onClick={() => setIsDrawerOpen(true)}>
          View onboarding checklist
        </Button>
      </div>

      <Drawer
        id="onboarding-checklist-drawer"
        isOpen={isDrawerOpen}
        onClose={() => setIsDrawerOpen(false)}
      >
        {content}
      </Drawer>

      <div className="hidden lg:block sticky top-6">{content}</div>
    </div>
  );
}

interface StepItemProps {
  step: OnboardingStep;
  onCtaClick?: (step: OnboardingStep) => void;
}

const statusConfig: Record<OnboardingStep['status'], { label: string; badgeVariant: BadgeVariant }> = {
  complete: { label: 'Complete', badgeVariant: 'success' },
  in_progress: { label: 'In Progress', badgeVariant: 'primary' },
  not_started: { label: 'Not Started', badgeVariant: 'secondary' },
  blocked: { label: 'Blocked', badgeVariant: 'error' },
};

function StepItem({ step, onCtaClick }: StepItemProps) {
  const Icon = step.icon;
  const status = statusConfig[step.status];
  const showProgress = typeof step.progressValue === 'number';
  const disabled = step.status === 'complete';
  const isImportStep = step.id === 'data_import';
  const handleClick = () => {
    onCtaClick?.(step);
  };

  return (
    <div className="rounded-lg border border-border bg-white p-4 shadow-sm">
      <div className="flex items-start gap-3">
        <div className="rounded-full bg-primary-50 p-2">
          <Icon className="h-5 w-5 text-primary-700" />
        </div>
        <div className="flex-1 space-y-2">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-foreground">{step.title}</p>
              <p className="text-xs text-muted-foreground">{step.description}</p>
              {isImportStep ? (
                <p className="mt-1 text-[11px] font-medium uppercase tracking-wide text-slate-500">
                  Complete your first import OR create 5 contacts
                </p>
              ) : null}
            </div>
            <Badge variant={status.badgeVariant}>{status.label}</Badge>
          </div>
          {showProgress ? (
            <Progress value={step.progressValue ?? 0} className="h-1.5" />
          ) : null}
          {Array.isArray(step.substeps) && step.substeps.length > 0 ? (
            <SubstepList substeps={step.substeps} parentStatus={step.status} />
          ) : null}
          {step.blocker ? (
            <Alert variant="destructive" className="text-xs">
              <AlertDescription>{step.blocker}</AlertDescription>
            </Alert>
          ) : null}
          {disabled ? (
            <Button id={`onboarding-${step.id}-cta`} size="sm" className="w-full" disabled>
              Completed
            </Button>
          ) : (
            <Button
              id={`onboarding-${step.id}-cta`}
              variant="secondary"
              size="sm"
              className="w-full"
              asChild
              onClick={handleClick}
            >
              <Link href={step.ctaHref}>{step.ctaLabel}</Link>
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function SubstepList({
  substeps,
  parentStatus,
}: {
  substeps: Array<{ id: string; title: string; status: string }>;
  parentStatus: OnboardingStep['status'];
}) {
  return (
    <ul className="space-y-1.5 pt-1">
      {substeps.map((substep) => {
        const showOnlyCompletion = parentStatus === 'in_progress' || parentStatus === 'not_started';
        const isComplete = substep.status === 'complete';
        const isBlocked = substep.status === 'blocked';
        const Icon = isComplete ? CheckCircle2 : showOnlyCompletion ? Circle : isBlocked ? AlertCircle : Circle;
        const color = isComplete
          ? 'text-emerald-600'
          : showOnlyCompletion
            ? 'text-slate-400'
            : isBlocked
              ? 'text-red-600'
              : 'text-slate-400';

        return (
          <li key={substep.id} className="flex items-center gap-2 text-xs text-muted-foreground">
            <Icon className={`h-4 w-4 ${color}`} />
            <span className={substep.status === 'complete' ? 'text-slate-700' : undefined}>{substep.title}</span>
          </li>
        );
      })}
    </ul>
  );
}

function ChecklistSkeleton() {
  return (
    <div className="space-y-4">
      {[1, 2, 3].map((key) => (
        <div key={`checklist-skeleton-${key}`} className="rounded-lg border p-4 space-y-3">
          <Skeleton className="h-4 w-1/3" />
          <Skeleton className="h-3 w-2/3" />
          <Skeleton className="h-8 w-full" />
        </div>
      ))}
    </div>
  );
}
