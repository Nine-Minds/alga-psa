'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '@alga-psa/ui/components/Button';
import { Card } from '@alga-psa/ui/components/Card';
import { Input } from '@alga-psa/ui/components/Input';
import CustomSelect, { SelectOption } from '@alga-psa/ui/components/CustomSelect';
import { Badge } from '@alga-psa/ui/components/Badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@alga-psa/ui/components/Table';
import { TextArea } from '@alga-psa/ui/components/TextArea';
import { toast } from 'react-hot-toast';
import {
  exportWorkflowEventsAction,
  getWorkflowEventAction,
  listWorkflowEventSummaryAction,
  listWorkflowEventsAction
} from '../../../actions';
import WorkflowRunDetails from './WorkflowRunDetails';

type WorkflowEventRecord = {
  event_id: string;
  event_name: string;
  correlation_key?: string | null;
  payload_schema_ref?: string | null;
  schema_ref_conflict?: { submission: string; catalog: string } | null;
  created_at: string;
  processed_at?: string | null;
  matched_run_id?: string | null;
  matched_wait_id?: string | null;
  matched_step_path?: string | null;
  error_message?: string | null;
  payload?: Record<string, unknown> | null;
  status: 'matched' | 'unmatched' | 'error';
};

type WorkflowEventListResponse = {
  events: WorkflowEventRecord[];
  nextCursor: number | null;
};

type WorkflowEventDetailResponse = {
  event: WorkflowEventRecord;
  wait?: {
    wait_id: string;
    status: string;
    timeout_at?: string | null;
    resolved_at?: string | null;
    step_path?: string | null;
    wait_type?: string | null;
  } | null;
  run?: {
    run_id: string;
    status: string;
    workflow_id: string;
    workflow_version: number;
  } | null;
};

type WorkflowEventSummary = {
  total: number;
  matched: number;
  unmatched: number;
  error: number;
};

type EventFilters = {
  eventName: string;
  correlationKey: string;
  status: string;
  from: string;
  to: string;
};

const STATUS_OPTIONS: SelectOption[] = [
  { value: 'all', label: 'All statuses' },
  { value: 'matched', label: 'Matched' },
  { value: 'unmatched', label: 'Unmatched' },
  { value: 'error', label: 'Error' }
];

const EVENT_STATUS_STYLES: Record<string, string> = {
  matched: 'bg-green-100 text-green-700',
  unmatched: 'bg-amber-100 text-amber-700',
  error: 'bg-red-100 text-red-700'
};

const DEFAULT_FILTERS: EventFilters = {
  eventName: '',
  correlationKey: '',
  status: 'all',
  from: '',
  to: ''
};

const formatDateTime = (value?: string | null) => {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
};

const payloadPreview = (payload?: Record<string, unknown> | null) => {
  if (!payload || Object.keys(payload).length === 0) return '—';
  const text = JSON.stringify(payload);
  if (text.length <= 140) return text;
  return `${text.slice(0, 140)}...`;
};

interface WorkflowEventListProps {
  isActive: boolean;
  canAdmin?: boolean;
}

const WorkflowEventList: React.FC<WorkflowEventListProps> = ({ isActive, canAdmin = false }) => {
  const [filters, setFilters] = useState<EventFilters>(DEFAULT_FILTERS);
  const [events, setEvents] = useState<WorkflowEventRecord[]>([]);
  const [nextCursor, setNextCursor] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [summary, setSummary] = useState<WorkflowEventSummary | null>(null);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [eventDetail, setEventDetail] = useState<WorkflowEventDetailResponse | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const handleRunDetailsClose = useCallback(() => setSelectedRunId(null), []);
  const limit = 25;

  const fetchEvents = useCallback(
    async (cursor = 0, append = false, overrideFilters?: EventFilters) => {
      const activeFilters = overrideFilters ?? filters;
      setIsLoading(true);
      try {
        const data = (await listWorkflowEventsAction({
          eventName: activeFilters.eventName || undefined,
          correlationKey: activeFilters.correlationKey || undefined,
          status: activeFilters.status !== 'all' ? (activeFilters.status as any) : undefined,
          from: activeFilters.from || undefined,
          to: activeFilters.to || undefined,
          limit,
          cursor
        })) as WorkflowEventListResponse;
        setEvents((prev) => (append ? [...prev, ...data.events] : data.events));
        setNextCursor(data.nextCursor ?? null);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Failed to load workflow events');
      } finally {
        setIsLoading(false);
      }
    },
    [filters]
  );

  const fetchSummary = useCallback(
    async (overrideFilters?: EventFilters) => {
      const activeFilters = overrideFilters ?? filters;
      try {
        const data = (await listWorkflowEventSummaryAction({
          eventName: activeFilters.eventName || undefined,
          correlationKey: activeFilters.correlationKey || undefined,
          from: activeFilters.from || undefined,
          to: activeFilters.to || undefined
        })) as WorkflowEventSummary;
        setSummary(data);
      } catch (error) {
        setSummary(null);
      }
    },
    [filters]
  );

  const fetchEventDetail = useCallback(async (eventId: string) => {
    setDetailLoading(true);
    try {
      const data = (await getWorkflowEventAction({ eventId })) as WorkflowEventDetailResponse;
      setEventDetail(data);
      setSelectedRunId(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to load event detail');
      setEventDetail(null);
      setSelectedRunId(null);
    } finally {
      setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isActive) return;
    fetchEvents(0, false);
    fetchSummary();
  }, [fetchEvents, fetchSummary, isActive]);

  useEffect(() => {
    if (!selectedEventId) {
      setEventDetail(null);
      return;
    }
    fetchEventDetail(selectedEventId);
  }, [fetchEventDetail, selectedEventId]);

  const handleApplyFilters = () => {
    fetchEvents(0, false, filters);
    fetchSummary(filters);
  };

  const handleResetFilters = () => {
    setFilters(DEFAULT_FILTERS);
    fetchEvents(0, false, DEFAULT_FILTERS);
    fetchSummary(DEFAULT_FILTERS);
  };

  const handleExport = async (format: 'csv' | 'json') => {
    try {
      const result = await exportWorkflowEventsAction({
        format,
        eventName: filters.eventName || undefined,
        correlationKey: filters.correlationKey || undefined,
        status: filters.status !== 'all' ? (filters.status as any) : undefined,
        from: filters.from || undefined,
        to: filters.to || undefined,
        limit: 1000,
        cursor: 0
      });
      const blob = new Blob([result.body], { type: result.contentType });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = result.filename;
      link.click();
      window.URL.revokeObjectURL(url);
      toast.success('Event export ready');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to export events');
    }
  };

  const detailPayload = useMemo(() => {
    if (!eventDetail?.event.payload) return '';
    try {
      return JSON.stringify(eventDetail.event.payload, null, 2);
    } catch {
      return '';
    }
  }, [eventDetail]);

  return (
    <div className="flex h-full gap-4">
      <div className="flex-1 space-y-3 overflow-hidden">
        <Card className="p-4 space-y-3">
          {summary && (
            <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500">
              <span>Total: {summary.total}</span>
              <Badge className={EVENT_STATUS_STYLES.matched}>Matched: {summary.matched}</Badge>
              <Badge className={EVENT_STATUS_STYLES.unmatched}>Unmatched: {summary.unmatched}</Badge>
              <Badge className={EVENT_STATUS_STYLES.error}>Errors: {summary.error}</Badge>
            </div>
          )}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Input
              id="workflow-events-name"
              label="Event name"
              value={filters.eventName}
              onChange={(event) => setFilters((prev) => ({ ...prev, eventName: event.target.value }))}
              placeholder="workflow.event"
            />
            <Input
              id="workflow-events-correlation"
              label="Correlation key"
              value={filters.correlationKey}
              onChange={(event) => setFilters((prev) => ({ ...prev, correlationKey: event.target.value }))}
              placeholder="corr-123"
            />
            <CustomSelect
              id="workflow-events-status"
              label="Status"
              options={STATUS_OPTIONS}
              value={filters.status}
              onValueChange={(value) => setFilters((prev) => ({ ...prev, status: value }))}
            />
            <Input
              id="workflow-events-from"
              label="From"
              type="date"
              value={filters.from}
              onChange={(event) => setFilters((prev) => ({ ...prev, from: event.target.value }))}
            />
            <Input
              id="workflow-events-to"
              label="To"
              type="date"
              value={filters.to}
              onChange={(event) => setFilters((prev) => ({ ...prev, to: event.target.value }))}
            />
          </div>
          <div className="flex items-center gap-2">
            <Button id="workflow-events-apply" onClick={handleApplyFilters} disabled={isLoading}>
              Apply filters
            </Button>
            <Button id="workflow-events-reset" variant="outline" onClick={handleResetFilters} disabled={isLoading}>
              Reset
            </Button>
            <Button id="workflow-events-export-csv" variant="outline" onClick={() => handleExport('csv')}>
              Export CSV
            </Button>
            <Button id="workflow-events-export-json" variant="outline" onClick={() => handleExport('json')}>
              Export JSON
            </Button>
          </div>
        </Card>

        <Card className="p-4 overflow-hidden">
          <div className="overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Event</TableHead>
                  <TableHead>Correlation</TableHead>
                  <TableHead>Schema</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Matched Run</TableHead>
                  <TableHead>Payload</TableHead>
                  <TableHead>Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {events.map((event) => (
                  <TableRow
                    key={event.event_id}
                    className={selectedEventId === event.event_id ? 'bg-blue-50' : 'cursor-pointer'}
                    onClick={() => setSelectedEventId(event.event_id)}
                  >
                    <TableCell>{event.event_name}</TableCell>
                    <TableCell className="font-mono text-xs">{event.correlation_key ?? '—'}</TableCell>
                    <TableCell className="text-[11px] text-gray-600 max-w-[260px]">
                      <div className="font-mono truncate">{event.payload_schema_ref ?? '—'}</div>
                      {event.schema_ref_conflict && (
                        <div className="text-[10px] text-amber-700">
                          catalog ≠ submission
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge className={EVENT_STATUS_STYLES[event.status] ?? 'bg-gray-100 text-gray-600'}>
                        {event.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-mono text-xs">{event.matched_run_id ?? '—'}</TableCell>
                    <TableCell className="text-xs text-gray-600 max-w-[220px] truncate">
                      {payloadPreview(event.payload)}
                    </TableCell>
                    <TableCell>{formatDateTime(event.created_at)}</TableCell>
                  </TableRow>
                ))}
                {events.length === 0 && !isLoading && (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-sm text-gray-500 py-6">
                      No workflow events found.
                    </TableCell>
                  </TableRow>
                )}
                {isLoading && (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-sm text-gray-500 py-6">
                      Loading events...
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
          {nextCursor !== null && (
            <div className="flex justify-center mt-4">
              <Button
                id="workflow-events-load-more"
                variant="outline"
                onClick={() => fetchEvents(nextCursor, true)}
                disabled={isLoading}
              >
                Load more
              </Button>
            </div>
          )}
        </Card>
      </div>

      {selectedEventId && (
        <div className="w-[480px] shrink-0 overflow-auto space-y-4">
          <Card id="workflow-event-detail-panel" className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold">Event Detail</div>
              <Button id="workflow-event-detail-close" variant="ghost" onClick={() => setSelectedEventId(null)}>
                Close
              </Button>
            </div>
            {detailLoading && <div className="text-sm text-gray-500">Loading event detail...</div>}
            {!detailLoading && eventDetail && (
              <>
                <div className="text-xs text-gray-500">Event ID</div>
                <div id="workflow-event-detail-event-id" className="text-xs font-mono">
                  {eventDetail.event.event_id}
                </div>
                <div className="text-xs text-gray-500">Status</div>
                <Badge
                  id="workflow-event-detail-status"
                  className={EVENT_STATUS_STYLES[eventDetail.event.status] ?? 'bg-gray-100 text-gray-600'}
                >
                  {eventDetail.event.status}
                </Badge>
                <div className="text-xs text-gray-500">Event name</div>
                <div className="text-sm">{eventDetail.event.event_name}</div>
                <div className="text-xs text-gray-500">Correlation key</div>
                <div id="workflow-event-detail-correlation" className="text-sm font-mono">
                  {eventDetail.event.correlation_key ?? '—'}
                </div>
                <div className="text-xs text-gray-500">Payload schema ref</div>
                <div className="text-sm font-mono break-all">
                  {eventDetail.event.payload_schema_ref ?? '—'}
                </div>
                {eventDetail.event.schema_ref_conflict && (
                  <div className="rounded border border-amber-200 bg-amber-50 p-2 text-[11px] text-amber-800">
                    Schema ref conflict: catalog <code className="bg-amber-100 px-1 rounded">{eventDetail.event.schema_ref_conflict.catalog}</code> vs submission <code className="bg-amber-100 px-1 rounded">{eventDetail.event.schema_ref_conflict.submission}</code>
                  </div>
                )}
                <div className="text-xs text-gray-500">Created</div>
                <div className="text-sm">{formatDateTime(eventDetail.event.created_at)}</div>
                <div className="text-xs text-gray-500">Processed</div>
                <div className="text-sm">{formatDateTime(eventDetail.event.processed_at ?? null)}</div>
                {eventDetail.event.error_message && (
                  <div className="text-sm text-red-600">Error: {eventDetail.event.error_message}</div>
                )}
                {eventDetail.wait && (
                  <div className="space-y-1">
                    <div className="text-xs text-gray-500">Wait</div>
                    <div id="workflow-event-detail-wait-id" className="text-xs font-mono">
                      Wait ID: {eventDetail.wait.wait_id}
                    </div>
                    <div id="workflow-event-detail-wait-status" className="text-xs">
                      Status: {eventDetail.wait.status}
                    </div>
                    <div className="text-xs">Timeout: {formatDateTime(eventDetail.wait.timeout_at ?? null)}</div>
                    <div className="text-xs">Resolved: {formatDateTime(eventDetail.wait.resolved_at ?? null)}</div>
                    <div className="text-xs">Step: {eventDetail.wait.step_path ?? '—'}</div>
                  </div>
                )}
                {eventDetail.run && (
                  <div className="space-y-2">
                    <div className="text-xs text-gray-500">Matched run</div>
                    <div id="workflow-event-detail-run-id" className="text-xs font-mono">
                      {eventDetail.run.run_id}
                    </div>
                    <div id="workflow-event-detail-run-status" className="text-xs">
                      Status: {eventDetail.run.status}
                    </div>
                    <Button
                      id="workflow-event-view-run"
                      variant="outline"
                      onClick={() => setSelectedRunId(eventDetail.run?.run_id ?? null)}
                    >
                      View run details
                    </Button>
                  </div>
                )}
                <TextArea
                  id="workflow-event-payload"
                  label="Payload"
                  value={detailPayload}
                  readOnly
                  rows={8}
                  className="font-mono text-xs"
                />
              </>
            )}
          </Card>

          {selectedRunId && (
            <WorkflowRunDetails
              runId={selectedRunId}
              canAdmin={canAdmin}
              onClose={handleRunDetailsClose}
            />
          )}
        </div>
      )}
    </div>
  );
};

export default WorkflowEventList;
