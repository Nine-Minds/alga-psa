'use client';

import { Card } from '@alga-psa/ui/components/Card';
import type { JobMetrics } from '@alga-psa/jobs/actions';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { CheckCircle2, XCircle, Clock, ListChecks, Activity } from 'lucide-react';

interface JobMetricsDisplayProps {
  metrics: JobMetrics;
}

export default function JobMetricsDisplay({ metrics }: JobMetricsDisplayProps) {
  const { t } = useTranslation('msp/jobs');

  // Success rate is outcomes over outcomes: completed of (completed + failed).
  // Queued/pending jobs haven't had a chance to succeed, so they don't belong in
  // the denominator. Null until at least one job has finished.
  const finishedJobs = metrics.completed + metrics.failed;
  const successRate = finishedJobs > 0
    ? Math.round((metrics.completed / finishedJobs) * 100)
    : null;

  // Genuinely in-flight jobs = processing + active. Derived from the counts the
  // action returns (queued is reported separately and is NOT running).
  const runningJobs = Math.max(
    0,
    metrics.total - metrics.completed - metrics.failed - metrics.pending - metrics.queued
  );

  const isMixedRunners = metrics.byRunner && metrics.byRunner.pgboss > 0 && metrics.byRunner.temporal > 0;

  // Status counts over every job in the tenant (the table below is capped at the
  // most recent runs). Rendered as one quiet strip so the job table stays primary.
  const segments = [
    { key: 'running', label: t('metrics.labels.running', { defaultValue: 'Running' }), value: runningJobs, icon: Activity },
    { key: 'queued', label: t('metrics.labels.queued', { defaultValue: 'Queued' }), value: metrics.queued, icon: ListChecks },
    { key: 'pending', label: t('metrics.labels.pending', { defaultValue: 'Pending' }), value: metrics.pending, icon: Clock },
    { key: 'completed', label: t('metrics.labels.completed', { defaultValue: 'Completed' }), value: metrics.completed, icon: CheckCircle2 },
  ];

  // Failure is the one count worth shouting — but only when there is one.
  const hasFailures = metrics.failed > 0;

  return (
    <Card id="job-metrics-strip" className="px-5 py-3">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
        {segments.map(({ key, label, value, icon: Icon }) => (
          <div key={key} id={`${key}-jobs-metric`} className="flex items-center gap-2">
            <Icon className="h-4 w-4 text-[rgb(var(--color-text-400))]" />
            <span className="font-semibold tabular-nums text-[rgb(var(--color-text-900))]">{value}</span>
            <span className="text-[rgb(var(--color-text-500))]">{label}</span>
          </div>
        ))}

        <div
          id="failed-jobs-metric"
          className={`flex items-center gap-2 rounded px-2 py-0.5 ${hasFailures ? 'bg-[rgb(var(--color-accent-50))]' : ''}`}
        >
          <XCircle className={`h-4 w-4 ${hasFailures ? 'text-[rgb(var(--color-accent-500))]' : 'text-[rgb(var(--color-text-400))]'}`} />
          <span className={`font-semibold tabular-nums ${hasFailures ? 'text-[rgb(var(--color-accent-600))]' : 'text-[rgb(var(--color-text-900))]'}`}>
            {metrics.failed}
          </span>
          <span className={hasFailures ? 'text-[rgb(var(--color-accent-600))]' : 'text-[rgb(var(--color-text-500))]'}>
            {t('metrics.labels.failed', { defaultValue: 'Failed' })}
          </span>
        </div>

        <div className="ml-auto flex items-center gap-4 text-[rgb(var(--color-text-600))]">
          {isMixedRunners && (
            <span className="text-[rgb(var(--color-text-500))]">
              <span className="font-semibold tabular-nums text-[rgb(var(--color-text-700))]">{metrics.byRunner.pgboss}</span>
              {' '}{t('metrics.labels.pgboss', { defaultValue: 'PG Boss' })}
              <span className="mx-2 text-[rgb(var(--color-border-300))]">·</span>
              <span className="font-semibold tabular-nums text-[rgb(var(--color-text-700))]">{metrics.byRunner.temporal}</span>
              {' '}{t('metrics.labels.temporal', { defaultValue: 'Temporal' })}
            </span>
          )}
          <span>
            {successRate !== null
              ? t('metrics.successRate', { defaultValue: '{{count}}% success rate', count: successRate })
              : t('metrics.successRateNone', { defaultValue: 'No finished jobs yet' })}
          </span>
        </div>
      </div>
    </Card>
  );
}
