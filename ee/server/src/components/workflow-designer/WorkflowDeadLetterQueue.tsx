'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Button } from '@alga-psa/ui/components/Button';
import { Card } from '@alga-psa/ui/components/Card';
import { Input } from '@alga-psa/ui/components/Input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@alga-psa/ui/components/Table';
import { Badge } from '@alga-psa/ui/components/Badge';
import { toast } from 'react-hot-toast';
import { listWorkflowDeadLetterRunsAction } from '@alga-psa/workflows/actions';
import WorkflowRunDetails from './WorkflowRunDetails';

type DeadLetterRun = {
  run_id: string;
  workflow_id: string;
  workflow_name?: string | null;
  workflow_version: number;
  tenant_id?: string | null;
  status: string;
  started_at: string;
  updated_at: string;
  completed_at?: string | null;
  max_attempt?: number | null;
  failed_steps?: number | null;
};

type DeadLetterResponse = {
  runs: DeadLetterRun[];
  nextCursor: number | null;
};

const STATUS_STYLES: Record<string, string> = {
  RUNNING: 'bg-blue-100 text-blue-700',
  WAITING: 'bg-amber-100 text-amber-700',
  SUCCEEDED: 'bg-green-100 text-green-700',
  FAILED: 'bg-red-100 text-red-700',
  CANCELED: 'bg-gray-100 text-gray-600'
};

const formatDateTime = (value?: string | null) => {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
};

interface WorkflowDeadLetterQueueProps {
  isActive: boolean;
  canAdmin?: boolean;
}

const WorkflowDeadLetterQueue: React.FC<WorkflowDeadLetterQueueProps> = ({ isActive, canAdmin = false }) => {
  const [runs, setRuns] = useState<DeadLetterRun[]>([]);
  const [nextCursor, setNextCursor] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [minRetries, setMinRetries] = useState('3');
  const limit = 25;
  const handleRunDetailsClose = useCallback(() => setSelectedRunId(null), []);

  const fetchDeadLetter = useCallback(
    async (cursor = 0, append = false) => {
      setIsLoading(true);
      try {
        const data = (await listWorkflowDeadLetterRunsAction({
          limit,
          cursor,
          minRetries: minRetries || undefined
        })) as DeadLetterResponse;
        setRuns((prev) => (append ? [...prev, ...data.runs] : data.runs));
        setNextCursor(data.nextCursor ?? null);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Failed to load dead-letter runs');
      } finally {
        setIsLoading(false);
      }
    },
    [minRetries]
  );

  useEffect(() => {
    if (!isActive) return;
    fetchDeadLetter(0, false);
  }, [fetchDeadLetter, isActive]);

  const selectedRun = runs.find((run) => run.run_id === selectedRunId) ?? null;

  return (
    <div className="flex h-full gap-4">
      <div className="flex-1 space-y-3 overflow-hidden">
        <Card className="p-4 space-y-3">
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex-1 min-w-[220px]">
              <Input
                id="workflow-dead-letter-min-retries"
                label="Minimum retries"
                type="number"
                value={minRetries}
                onChange={(event) => setMinRetries(event.target.value)}
                placeholder="3"
              />
            </div>
            <Button id="workflow-dead-letter-refresh" variant="outline" onClick={() => fetchDeadLetter(0, false)}>
              Refresh
            </Button>
          </div>
        </Card>

        <Card className="p-4 overflow-hidden">
          <div className="overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Run ID</TableHead>
                  <TableHead>Workflow</TableHead>
                  <TableHead>Version</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Retries</TableHead>
                  <TableHead>Failed Steps</TableHead>
                  <TableHead>Updated</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {runs.map((run) => (
                  <TableRow
                    key={run.run_id}
                    className={selectedRunId === run.run_id ? 'bg-blue-50' : 'cursor-pointer'}
                    onClick={() => setSelectedRunId(run.run_id)}
                  >
                    <TableCell className="font-mono text-xs">{run.run_id}</TableCell>
                    <TableCell>{run.workflow_name ?? run.workflow_id}</TableCell>
                    <TableCell>v{run.workflow_version}</TableCell>
                    <TableCell>
                      <Badge className={STATUS_STYLES[run.status] ?? 'bg-gray-100 text-gray-600'}>
                        {run.status}
                      </Badge>
                    </TableCell>
                    <TableCell>{run.max_attempt ?? '—'}</TableCell>
                    <TableCell>{run.failed_steps ?? '—'}</TableCell>
                    <TableCell>{formatDateTime(run.updated_at)}</TableCell>
                  </TableRow>
                ))}
                {runs.length === 0 && !isLoading && (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-sm text-gray-500 py-6">
                      No dead-letter runs found.
                    </TableCell>
                  </TableRow>
                )}
                {isLoading && (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-sm text-gray-500 py-6">
                      Loading dead-letter runs...
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
          {nextCursor !== null && (
            <div className="flex justify-center mt-4">
              <Button
                id="workflow-dead-letter-load-more"
                variant="outline"
                onClick={() => fetchDeadLetter(nextCursor, true)}
              >
                Load more
              </Button>
            </div>
          )}
        </Card>
      </div>

      {selectedRun && (
        <div className="w-[480px] shrink-0 overflow-auto">
          <WorkflowRunDetails
            runId={selectedRun.run_id}
            workflowName={selectedRun.workflow_name ?? undefined}
            canAdmin={canAdmin}
            onClose={handleRunDetailsClose}
          />
        </div>
      )}
    </div>
  );
};

export default WorkflowDeadLetterQueue;
