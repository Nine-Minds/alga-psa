'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { toast } from 'react-hot-toast';
import { Button } from '@alga-psa/ui/components/Button';
import { Card } from '@alga-psa/ui/components/Card';
import { useFormatters, useTranslation } from '@alga-psa/ui/lib/i18n/client';
import {
  exportWorkflowAuditLogsAction,
  listWorkflowAuditLogsAction,
} from '@alga-psa/workflows/actions';
import { mapWorkflowServerError } from './workflowServerErrors';

type WorkflowAuditLogRecord = {
  audit_id: string;
  timestamp: string;
  operation: string;
  user_id?: string | null;
  /** The acting user's name, resolved by the server; null when the user no longer exists. */
  user_name?: string | null;
  details?: Record<string, unknown> | null;
};

type WorkflowAuditLogResponse = {
  logs: WorkflowAuditLogRecord[];
  nextCursor: number | null;
};

type WorkflowDesignerAuditPanelProps = {
  workflowId: string;
  workflowName?: string | null;
  canAdmin: boolean;
};

const truncateJsonPreview = (value: unknown, maxChars: number) => {
  const serialized = JSON.stringify(value, null, 2);
  if (serialized.length <= maxChars) return serialized;
  return `${serialized.slice(0, maxChars)}\n… truncated …`;
};

const WorkflowDesignerAuditPanel: React.FC<WorkflowDesignerAuditPanelProps> = ({
  workflowId,
  workflowName,
  canAdmin,
}) => {
  const { t } = useTranslation('msp/workflows');
  const { formatDate } = useFormatters();
  const [logs, setLogs] = useState<WorkflowAuditLogRecord[]>([]);
  const [cursor, setCursor] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const limit = 10;

  const formatDateTime = useCallback((value?: string | null) => {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return formatDate(date, { dateStyle: 'medium', timeStyle: 'short' });
  }, [formatDate]);

  const fetchLogs = useCallback(async (cursorValue = 0, append = false) => {
    if (!canAdmin) return;
    setIsLoading(true);
    try {
      const data = (await listWorkflowAuditLogsAction({
        tableName: 'workflow_definitions',
        recordId: workflowId,
        limit,
        cursor: cursorValue,
      })) as WorkflowAuditLogResponse;
      setLogs((prev) => (append ? [...prev, ...data.logs] : data.logs));
      setCursor(data.nextCursor ?? null);
    } catch (error) {
      toast.error(mapWorkflowServerError(t, error, t('audit.toasts.loadFailed', {
        defaultValue: 'Failed to load audit logs',
      })));
    } finally {
      setIsLoading(false);
    }
  }, [canAdmin, limit, t, workflowId]);

  useEffect(() => {
    setLogs([]);
    setCursor(null);
    if (workflowId && canAdmin) {
      void fetchLogs(0, false);
    }
  }, [canAdmin, fetchLogs, workflowId]);

  const handleExport = async () => {
    if (!canAdmin) return;
    try {
      const result = await exportWorkflowAuditLogsAction({
        tableName: 'workflow_definitions',
        recordId: workflowId,
        format: 'csv',
      });
      const blob = new Blob([result.body], { type: result.contentType });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = result.filename;
      link.click();
      window.URL.revokeObjectURL(url);
      toast.success(t('audit.toasts.exportReady', { defaultValue: 'Audit export ready' }));
    } catch (error) {
      toast.error(mapWorkflowServerError(t, error, t('audit.toasts.exportFailed', {
        defaultValue: 'Failed to export audit logs',
      })));
    }
  };

  if (!canAdmin) return null;

  return (
    <Card id="workflow-audit-panel" className="p-3 space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-[rgb(var(--color-text-800))]">
            {t('audit.header.title', { defaultValue: 'Workflow Audit' })}
          </div>
          <div className="truncate text-xs text-[rgb(var(--color-text-500))]">
            {workflowName || workflowId}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            id="workflow-audit-refresh"
            variant="outline"
            size="sm"
            onClick={() => void fetchLogs(0, false)}
            disabled={isLoading}
          >
            {t('audit.actions.refresh', { defaultValue: 'Refresh' })}
          </Button>
          <Button
            id="workflow-audit-export"
            variant="outline"
            size="sm"
            onClick={handleExport}
          >
            {t('audit.actions.exportCsv', { defaultValue: 'Export CSV' })}
          </Button>
        </div>
      </div>

      {/* The properties panel is narrow, so each entry stacks its fields instead of using table
          columns; long values wrap or truncate (full value in the tooltip) rather than scroll sideways. */}
      <div className="max-h-80 overflow-y-auto overflow-x-hidden rounded border border-[rgb(var(--color-border-200))]">
        {logs.length > 0 ? (
          <ul id="workflow-audit-entries" className="divide-y divide-[rgb(var(--color-border-200))]">
            {logs.map((log) => {
              const userLabel = !log.user_id
                ? t('audit.values.system', { defaultValue: 'system' })
                : log.user_name ?? t('audit.values.unknownUser', { defaultValue: 'Unknown user' });
              return (
                <li key={log.audit_id} id={`workflow-audit-entry-${log.audit_id}`} className="min-w-0 space-y-1 px-3 py-2">
                  <div className="flex min-w-0 items-baseline justify-between gap-2">
                    <span
                      className="min-w-0 truncate text-xs font-medium text-[rgb(var(--color-text-800))]"
                      title={log.operation}
                    >
                      {log.operation}
                    </span>
                    <span className="shrink-0 text-[11px] text-[rgb(var(--color-text-500))]">
                      {formatDateTime(log.timestamp)}
                    </span>
                  </div>
                  <div
                    className="truncate text-xs text-[rgb(var(--color-text-600))]"
                    title={log.user_id ?? undefined}
                  >
                    {t('audit.values.byUser', { defaultValue: 'By {{user}}', user: userLabel })}
                  </div>
                  {log.details ? (
                    <details className="text-xs">
                      <summary className="cursor-pointer text-[rgb(var(--color-text-500))]">
                        {t('audit.table.columns.details', { defaultValue: 'Details' })}
                      </summary>
                      <pre className="mt-1 max-h-32 overflow-y-auto whitespace-pre-wrap break-all rounded bg-[rgb(var(--color-text-900))] p-2 text-[rgb(var(--color-background))]">
                        {truncateJsonPreview(log.details, 600)}
                      </pre>
                    </details>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : (
          <div className="py-4 text-center text-sm text-[rgb(var(--color-text-500))]">
            {isLoading
              ? t('audit.states.loading', { defaultValue: 'Loading audit entries...' })
              : t('audit.states.empty', { defaultValue: 'No audit entries yet.' })}
          </div>
        )}
      </div>

      {cursor !== null && (
        <div className="flex justify-center">
          <Button
            id="workflow-audit-load-more"
            variant="outline"
            size="sm"
            onClick={() => void fetchLogs(cursor, true)}
            disabled={isLoading}
          >
            {t('audit.actions.loadMore', { defaultValue: 'Load more' })}
          </Button>
        </div>
      )}
    </Card>
  );
};

export default WorkflowDesignerAuditPanel;
