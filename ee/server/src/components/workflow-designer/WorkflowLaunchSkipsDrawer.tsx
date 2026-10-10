'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Badge } from '@alga-psa/ui/components/Badge';
import { Button } from '@alga-psa/ui/components/Button';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import Drawer from '@alga-psa/ui/components/Drawer';
import { useFormatters, useTranslation } from '@alga-psa/ui/lib/i18n/client';
import type { ColumnDefinition } from '@alga-psa/types';
import {
  getWorkflowLaunchSkipSummaryAction,
  listWorkflowLaunchSkipsPagedAction,
  type WorkflowLaunchSkipListItem,
  type WorkflowLaunchSkipSummary,
} from '@alga-psa/workflows/actions';
import {
  WORKFLOW_LAUNCH_SKIP_REASON_HINT_KEYS,
  WORKFLOW_LAUNCH_SKIP_REASON_LABEL_KEYS,
  isWorkflowLaunchSkipReason,
  type WorkflowLaunchSkipReason,
} from '@alga-psa/workflows/lib/workflowLaunchSkipReasons';

type WindowKey = '24h' | '7d' | '30d';
type GroupKey = 'attention' | 'guarded';

const WINDOW_MS: Record<WindowKey, number> = {
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
};
const ALL_REASONS = '__all__';
const PAGE_SIZE = 10;

type Props = {
  workflowId: string;
  isOpen: boolean;
  onClose: () => void;
};

type ValidationIssue = { path?: string; message?: string; code?: string };

export default function WorkflowLaunchSkipsDrawer({ workflowId, isOpen, onClose }: Props) {
  const { t } = useTranslation('msp/workflows');
  const { formatDate, formatRelativeTime } = useFormatters();

  const [windowKey, setWindowKey] = useState<WindowKey>('7d');
  const [group, setGroup] = useState<GroupKey>('attention');
  const [reasonFilter, setReasonFilter] = useState<string>(ALL_REASONS);
  const [page, setPage] = useState(1);
  const [summary, setSummary] = useState<WorkflowLaunchSkipSummary | null>(null);
  const [items, setItems] = useState<WorkflowLaunchSkipListItem[]>([]);
  const [totalItems, setTotalItems] = useState(0);
  const [loadError, setLoadError] = useState(false);
  const [expandedSkipId, setExpandedSkipId] = useState<string | null>(null);

  const reasonLabel = useCallback(
    (reason: string) =>
      isWorkflowLaunchSkipReason(reason)
        ? t(WORKFLOW_LAUNCH_SKIP_REASON_LABEL_KEYS[reason], { defaultValue: reason })
        : reason,
    [t]
  );

  const intentional = group === 'guarded';
  const groupSummary = summary ? (intentional ? summary.intentional : summary.alarming) : null;

  // Reset paging/expansion whenever the filter shape changes.
  useEffect(() => {
    setPage(1);
    setExpandedSkipId(null);
  }, [windowKey, group, reasonFilter]);

  // Changing group invalidates the reason filter (reasons differ per group).
  useEffect(() => {
    setReasonFilter(ALL_REASONS);
  }, [group]);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    const from = new Date(Date.now() - WINDOW_MS[windowKey]).toISOString();
    (async () => {
      try {
        const [nextSummary, nextList] = await Promise.all([
          getWorkflowLaunchSkipSummaryAction({ workflowId, from }),
          listWorkflowLaunchSkipsPagedAction({
            workflowId,
            from,
            intentional,
            ...(reasonFilter !== ALL_REASONS ? { reason: reasonFilter } : {}),
            page,
            pageSize: PAGE_SIZE,
          }),
        ]);
        if (cancelled) return;
        setSummary(nextSummary);
        setItems(nextList.items);
        setTotalItems(nextList.totalItems);
        setLoadError(false);
      } catch (error) {
        console.error('Failed to load workflow launch skips', error);
        if (!cancelled) setLoadError(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isOpen, workflowId, windowKey, intentional, reasonFilter, page]);

  const windowOptions = useMemo(
    () => [
      { value: '24h', label: t('designer.launchSkips.drawer.window.24h', { defaultValue: 'Last 24 hours' }) },
      { value: '7d', label: t('designer.launchSkips.drawer.window.7d', { defaultValue: 'Last 7 days' }) },
      { value: '30d', label: t('designer.launchSkips.drawer.window.30d', { defaultValue: 'Last 30 days' }) },
    ],
    [t]
  );

  const reasonOptions = useMemo(
    () => [
      { value: ALL_REASONS, label: t('designer.launchSkips.drawer.allReasons', { defaultValue: 'All reasons' }) },
      ...(groupSummary?.byReason ?? []).map((entry) => ({
        value: entry.reason,
        label: reasonLabel(entry.reason),
      })),
    ],
    [groupSummary, reasonLabel, t]
  );

  const columns: ColumnDefinition<WorkflowLaunchSkipListItem>[] = useMemo(
    () => [
      {
        title: t('designer.launchSkips.drawer.columns.received', { defaultValue: 'Received' }),
        dataIndex: 'createdAt',
        width: '140px',
        render: (_value: unknown, record: WorkflowLaunchSkipListItem) => (
          <span title={formatDate(record.createdAt, { dateStyle: 'medium', timeStyle: 'short' })}>
            {formatRelativeTime(record.createdAt)}
          </span>
        ),
      },
      {
        title: t('designer.launchSkips.drawer.columns.event', { defaultValue: 'Event' }),
        dataIndex: 'eventDisplayName',
        render: (_value: unknown, record: WorkflowLaunchSkipListItem) => record.eventDisplayName || record.eventName,
      },
      {
        title: t('designer.launchSkips.drawer.columns.reason', { defaultValue: 'Reason' }),
        dataIndex: 'reason',
        render: (_value: unknown, record: WorkflowLaunchSkipListItem) => (
          <Badge variant={record.intentional ? 'default-muted' : 'warning'}>{reasonLabel(record.reason)}</Badge>
        ),
      },
      {
        title: t('designer.launchSkips.drawer.columns.message', { defaultValue: 'Message' }),
        dataIndex: 'message',
        render: (_value: unknown, record: WorkflowLaunchSkipListItem) => (
          <span className="line-clamp-2 text-sm" title={record.message}>
            {record.message}
          </span>
        ),
      },
    ],
    [formatDate, formatRelativeTime, reasonLabel, t]
  );

  const renderExpanded = (record: WorkflowLaunchSkipListItem) => {
    if (record.skipId !== expandedSkipId) return null;
    const issues = Array.isArray(record.details?.issues) ? (record.details!.issues as ValidationIssue[]) : [];
    return (
      <div className="space-y-2 p-3 text-sm" data-testid="launch-skip-expanded">
        <div className="whitespace-pre-wrap break-words">{record.message}</div>
        {issues.length > 0 && (
          <div>
            <div className="text-xs font-medium text-[rgb(var(--color-text-600))]">
              {t('designer.launchSkips.drawer.issuesTitle', { defaultValue: 'Validation issues' })}
            </div>
            <ul className="list-disc pl-5">
              {issues.map((issue, index) => (
                <li key={`${issue.path ?? ''}-${index}`}>
                  <span className="font-mono text-xs">
                    {issue.path || t('designer.launchSkips.drawer.issueRoot', { defaultValue: '(payload)' })}
                  </span>
                  {': '}
                  {issue.message}
                </li>
              ))}
            </ul>
          </div>
        )}
        {/* The event id appears only inside the link target, never as visible text. */}
        <Link
          id="workflow-launch-skips-open-event"
          className="text-sm text-[rgb(var(--color-primary-600))] underline"
          href={`/msp/workflow-control?section=events&eventId=${encodeURIComponent(record.eventId)}`}
        >
          {t('designer.launchSkips.drawer.openEvent', { defaultValue: 'Open event' })}
        </Link>
      </div>
    );
  };

  return (
    <Drawer id="workflow-launch-skips-drawer" isOpen={isOpen} onClose={onClose} width="720px">
      <div className="space-y-4 p-1">
        <h2 className="text-lg font-semibold">
          {t('designer.launchSkips.drawer.title', { defaultValue: 'Skipped events' })}
        </h2>

        <div className="flex items-end gap-3">
          <div className="w-48">
            <CustomSelect
              id="workflow-launch-skips-window"
              label={t('designer.launchSkips.drawer.windowLabel', { defaultValue: 'Time window' })}
              options={windowOptions}
              value={windowKey}
              onValueChange={(value) => setWindowKey(value as WindowKey)}
            />
          </div>
          <div className="w-64">
            <CustomSelect
              id="workflow-launch-skips-reason"
              label={t('designer.launchSkips.drawer.reasonLabel', { defaultValue: 'Reason' })}
              options={reasonOptions}
              value={reasonFilter}
              onValueChange={setReasonFilter}
            />
          </div>
        </div>

        <div className="flex gap-2">
          <Button
            id="workflow-launch-skips-group-attention"
            size="sm"
            variant={group === 'attention' ? 'default' : 'outline'}
            onClick={() => setGroup('attention')}
          >
            {t('designer.launchSkips.drawer.groupAttention', { defaultValue: 'Needs attention' })}
            {summary ? ` (${summary.alarming.total})` : ''}
          </Button>
          <Button
            id="workflow-launch-skips-group-guarded"
            size="sm"
            variant={group === 'guarded' ? 'default' : 'outline'}
            onClick={() => setGroup('guarded')}
          >
            {t('designer.launchSkips.drawer.groupGuarded', { defaultValue: 'Guarded / paused (intentional)' })}
            {summary ? ` (${summary.intentional.total})` : ''}
          </Button>
        </div>

        {loadError && (
          <div className="text-sm text-destructive">
            {t('designer.launchSkips.drawer.loadError', { defaultValue: 'Failed to load skipped events.' })}
          </div>
        )}

        {groupSummary && groupSummary.byReason.length > 0 && (
          <ul id="workflow-launch-skips-summary" className="space-y-2">
            {groupSummary.byReason.map((entry) => (
              <li key={entry.reason} className="rounded border border-[rgb(var(--color-border-200))] p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{reasonLabel(entry.reason)}</span>
                    <Badge variant={intentional ? 'default-muted' : 'warning'}>{entry.count}</Badge>
                  </div>
                  {entry.lastSkippedAt && (
                    <span className="text-xs text-[rgb(var(--color-text-600))]">
                      {t('designer.launchSkips.drawer.lastSeen', {
                        when: formatRelativeTime(entry.lastSkippedAt),
                        defaultValue: 'Last seen {{when}}',
                      })}
                    </span>
                  )}
                </div>
                {isWorkflowLaunchSkipReason(entry.reason) && (
                  <p className="mt-1 text-sm text-[rgb(var(--color-text-600))]">
                    {t(WORKFLOW_LAUNCH_SKIP_REASON_HINT_KEYS[entry.reason as WorkflowLaunchSkipReason], { defaultValue: '' })}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}

        <DataTable
          id="workflow-launch-skips-table"
          persistPageSize={false}
          data={items}
          columns={columns}
          pagination
          pageSize={PAGE_SIZE}
          currentPage={page}
          onPageChange={setPage}
          totalItems={totalItems}
          onRowClick={(record: WorkflowLaunchSkipListItem) =>
            setExpandedSkipId((current) => (current === record.skipId ? null : record.skipId))
          }
          expandedRowRender={renderExpanded}
        />
        {!loadError && totalItems === 0 && (
          <div className="text-sm text-[rgb(var(--color-text-600))]">
            {t('designer.launchSkips.drawer.empty', { defaultValue: 'No skipped events in this window.' })}
          </div>
        )}
      </div>
    </Drawer>
  );
}
