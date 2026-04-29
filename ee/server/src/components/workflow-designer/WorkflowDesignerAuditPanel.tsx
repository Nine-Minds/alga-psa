'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { toast } from 'react-hot-toast';
import { Button } from '@alga-psa/ui/components/Button';
import { Card } from '@alga-psa/ui/components/Card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@alga-psa/ui/components/Table';
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
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-gray-800 dark:text-gray-200">
            {t('audit.header.title', { defaultValue: 'Workflow Audit' })}
          </div>
          <div className="truncate text-xs text-gray-500">
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

      <div className="max-h-80 overflow-auto rounded border border-gray-200 dark:border-[rgb(var(--color-border-200))]">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('audit.table.columns.timestamp', { defaultValue: 'Timestamp' })}</TableHead>
              <TableHead>{t('audit.table.columns.operation', { defaultValue: 'Operation' })}</TableHead>
              <TableHead>{t('audit.table.columns.user', { defaultValue: 'User' })}</TableHead>
              <TableHead>{t('audit.table.columns.details', { defaultValue: 'Details' })}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {logs.map((log) => (
              <TableRow key={log.audit_id}>
                <TableCell className="text-xs text-gray-500">{formatDateTime(log.timestamp)}</TableCell>
                <TableCell className="text-xs text-gray-700 dark:text-gray-300">{log.operation}</TableCell>
                <TableCell className="text-xs text-gray-500">
                  {log.user_id ?? t('audit.values.system', { defaultValue: 'system' })}
                </TableCell>
                <TableCell>
                  {log.details ? (
                    <pre className="max-h-20 overflow-auto rounded bg-gray-900 p-2 text-xs text-gray-100">
                      {truncateJsonPreview(log.details, 600)}
                    </pre>
                  ) : t('audit.common.emptyValue', { defaultValue: '—' })}
                </TableCell>
              </TableRow>
            ))}
            {!isLoading && logs.length === 0 && (
              <TableRow>
                <TableCell colSpan={4} className="py-4 text-center text-sm text-gray-500">
                  {t('audit.states.empty', { defaultValue: 'No audit entries yet.' })}
                </TableCell>
              </TableRow>
            )}
            {isLoading && logs.length === 0 && (
              <TableRow>
                <TableCell colSpan={4} className="py-4 text-center text-sm text-gray-500">
                  {t('audit.states.loading', { defaultValue: 'Loading audit entries...' })}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
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
