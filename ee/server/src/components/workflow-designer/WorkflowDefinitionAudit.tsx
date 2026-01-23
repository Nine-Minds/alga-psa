'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Button } from '@alga-psa/ui/components/Button';
import { Card } from '@alga-psa/ui/components/Card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@alga-psa/ui/components/Table';
import { toast } from 'react-hot-toast';
import {
  exportWorkflowAuditLogsAction,
  listWorkflowAuditLogsAction
} from '@/lib/actions/workflow-runtime-v2-actions';

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

const formatDateTime = (value?: string | null) => {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
};

const truncateJsonPreview = (value: unknown, maxChars: number) => {
  const serialized = JSON.stringify(value, null, 2);
  if (serialized.length <= maxChars) {
    return { preview: serialized, truncated: false };
  }
  return { preview: `${serialized.slice(0, maxChars)}\n… truncated …`, truncated: true };
};

interface WorkflowDefinitionAuditProps {
  workflowId: string | null;
  workflowName?: string;
  isActive: boolean;
}

const WorkflowDefinitionAudit: React.FC<WorkflowDefinitionAuditProps> = ({ workflowId, workflowName, isActive }) => {
  const [logs, setLogs] = useState<WorkflowAuditLogRecord[]>([]);
  const [cursor, setCursor] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const limit = 25;

  const fetchLogs = useCallback(
    async (cursorValue = 0, append = false) => {
      if (!workflowId) return;
      setIsLoading(true);
      try {
        const data = (await listWorkflowAuditLogsAction({
          tableName: 'workflow_definitions',
          recordId: workflowId,
          limit,
          cursor: cursorValue
        })) as WorkflowAuditLogResponse;
        setLogs((prev) => (append ? [...prev, ...data.logs] : data.logs));
        setCursor(data.nextCursor ?? null);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Failed to load audit logs');
      } finally {
        setIsLoading(false);
      }
    },
    [limit, workflowId]
  );

  useEffect(() => {
    if (isActive) {
      fetchLogs(0, false);
    }
  }, [fetchLogs, isActive]);

  const handleExport = async () => {
    if (!workflowId) return;
    try {
      const result = await exportWorkflowAuditLogsAction({
        tableName: 'workflow_definitions',
        recordId: workflowId,
        format: 'csv'
      });
      const blob = new Blob([result.body], { type: result.contentType });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = result.filename;
      link.click();
      window.URL.revokeObjectURL(url);
      toast.success('Audit export ready');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to export audit logs');
    }
  };

  if (!workflowId) {
    return (
      <div className="flex-1 overflow-y-auto bg-gray-50">
        <div className="max-w-5xl mx-auto p-6">
          <Card className="p-6 text-sm text-gray-500">Select a workflow to view audit history.</Card>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto bg-gray-50">
      <div className="max-w-5xl mx-auto p-6 space-y-4">
        <Card className="p-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm text-gray-500">Workflow Audit</div>
              <div className="text-lg font-semibold text-gray-900">{workflowName ?? workflowId}</div>
            </div>
            <Button
              id="workflow-audit-export"
              variant="outline"
              onClick={handleExport}
            >
              Export CSV
            </Button>
          </div>
        </Card>

        <Card className="p-0 overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Timestamp</TableHead>
                <TableHead>Operation</TableHead>
                <TableHead>User</TableHead>
                <TableHead>Details</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {logs.map((log) => (
                <TableRow key={log.audit_id}>
                  <TableCell className="text-xs text-gray-500">{formatDateTime(log.timestamp)}</TableCell>
                  <TableCell className="text-xs text-gray-700">{log.operation}</TableCell>
                  <TableCell className="text-xs text-gray-500">{log.user_id ?? 'system'}</TableCell>
                  <TableCell>
                    {log.details ? (
                      <pre className="max-h-24 overflow-auto rounded bg-gray-900 text-gray-100 text-xs p-2">
                        {truncateJsonPreview(log.details, 2000).preview}
                      </pre>
                    ) : '—'}
                  </TableCell>
                </TableRow>
              ))}
              {!isLoading && logs.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-sm text-gray-500 py-6">
                    No audit entries yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
          {cursor !== null && (
            <div className="flex justify-center border-t bg-white p-4">
              <Button
                id="workflow-audit-load-more"
                variant="outline"
                onClick={() => fetchLogs(cursor, true)}
                disabled={isLoading}
              >
                Load more
              </Button>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
};

export default WorkflowDefinitionAudit;
