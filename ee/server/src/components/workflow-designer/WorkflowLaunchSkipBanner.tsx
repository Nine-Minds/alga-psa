'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { Button } from '@alga-psa/ui/components/Button';
import { useFormatters, useTranslation } from '@alga-psa/ui/lib/i18n/client';
import {
  getWorkflowLaunchSkipSummaryAction,
  type WorkflowLaunchSkipSummary,
} from '@alga-psa/workflows/actions';
import { WORKFLOW_LAUNCH_SKIP_REASON_LABEL_KEYS, isWorkflowLaunchSkipReason } from '@alga-psa/workflows/lib/workflowLaunchSkipReasons';
import WorkflowLaunchSkipsDrawer from './WorkflowLaunchSkipsDrawer';

const BANNER_WINDOW_DAYS = 7;
// How many reasons are spelled out in the banner line; the drawer has the rest.
const MAX_REASONS_IN_BANNER = 3;

type Props = {
  workflowId: string;
  /** Skips only matter for published workflows; callers pass false for drafts. */
  isPublished: boolean;
};

/**
 * Warning under the page title when the worker declined to launch this
 * published workflow for events in the last 7 days. Intentional skips (paused,
 * loop guards) never show here; they live in the drawer's "Guarded / paused" group.
 */
export default function WorkflowLaunchSkipBanner({ workflowId, isPublished }: Props) {
  const { t } = useTranslation('msp/workflows');
  const { formatRelativeTime } = useFormatters();
  const [summary, setSummary] = useState<WorkflowLaunchSkipSummary | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const from = new Date(Date.now() - BANNER_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
      setSummary(await getWorkflowLaunchSkipSummaryAction({ workflowId, from }));
    } catch (error) {
      // The banner is advisory; a failed read must not break the designer. Keep the last known state.
      console.error('Failed to load workflow launch skip summary', error);
    }
  }, [workflowId]);

  useEffect(() => {
    if (!isPublished) {
      setSummary(null);
      return;
    }
    void load();
    // "Within one event": refetch whenever the author comes back to the tab.
    const onFocus = () => void load();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [isPublished, load]);

  if (!isPublished || !summary || summary.alarming.total === 0) {
    return null;
  }

  const reasons = summary.alarming.byReason
    .slice(0, MAX_REASONS_IN_BANNER)
    .map((entry) => {
      const label = isWorkflowLaunchSkipReason(entry.reason)
        ? t(WORKFLOW_LAUNCH_SKIP_REASON_LABEL_KEYS[entry.reason], { defaultValue: entry.reason })
        : entry.reason;
      return `${label} (${entry.count})`;
    })
    .join(', ');

  return (
    <>
      <Alert id="workflow-launch-skip-banner" variant="warning" className="mt-3">
        <AlertDescription>
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="font-medium">
                {t('designer.launchSkips.banner.summary', {
                  count: summary.alarming.total,
                  days: BANNER_WINDOW_DAYS,
                  reasons,
                  defaultValue_one: 'Skipped {{count}} event in the last {{days}} days — {{reasons}}',
                  defaultValue_other: 'Skipped {{count}} events in the last {{days}} days — {{reasons}}',
                })}
              </div>
              {summary.alarming.lastSkippedAt && (
                <div className="text-xs text-[rgb(var(--color-text-600))]">
                  {t('designer.launchSkips.banner.lastSkipped', {
                    when: formatRelativeTime(summary.alarming.lastSkippedAt),
                    defaultValue: 'Last skipped {{when}}',
                  })}
                </div>
              )}
            </div>
            <Button
              id="workflow-launch-skips-view"
              variant="outline"
              size="sm"
              onClick={() => setDrawerOpen(true)}
            >
              {t('designer.launchSkips.banner.view', { defaultValue: 'View skipped events' })}
            </Button>
          </div>
        </AlertDescription>
      </Alert>
      <WorkflowLaunchSkipsDrawer
        workflowId={workflowId}
        isOpen={drawerOpen}
        onClose={() => setDrawerOpen(false)}
      />
    </>
  );
}
