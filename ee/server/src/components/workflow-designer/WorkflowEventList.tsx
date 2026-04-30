'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '@alga-psa/ui/components/Button';
import { Card } from '@alga-psa/ui/components/Card';
import { Input } from '@alga-psa/ui/components/Input';
import { useFormatters, useTranslation } from '@alga-psa/ui/lib/i18n/client';
import CustomSelect, { SelectOption } from '@alga-psa/ui/components/CustomSelect';
import { Badge } from '@alga-psa/ui/components/Badge';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import type { ColumnDefinition } from '@alga-psa/types';
import { TextArea } from '@alga-psa/ui/components/TextArea';
import { toast } from 'react-hot-toast';
import { mapWorkflowServerError } from './workflowServerErrors';
import {
  exportWorkflowEventsAction,
  getWorkflowEventAction,
  listWorkflowEventSummaryAction,
  listWorkflowEventsPagedAction
} from '@alga-psa/workflows/actions';
import {
  useFormatWorkflowEventStatus,
  useWorkflowEventStatusOptions,
} from '@alga-psa/workflows/hooks/useWorkflowEnumOptions';
import WorkflowRunDetailsPanel from '../workflow-run-studio/WorkflowRunDetailsPanel';

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

type WorkflowEventSortBy = 'created_at' | 'processed_at' | 'event_name' | 'correlation_key' | 'status';

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

const EVENT_STATUS_VARIANTS: Record<WorkflowEventRecord['status'], 'success' | 'warning' | 'error'> = {
  matched: 'success',
  unmatched: 'warning',
  error: 'error'
};

const DEFAULT_FILTERS: EventFilters = {
  eventName: '',
  correlationKey: '',
  status: 'all',
  from: '',
  to: ''
};

const useFormatDateTime = () => {
  const { formatDate } = useFormatters();
  return useCallback(
    (value?: string | null) => {
      if (!value) return '—';
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return value;
      return formatDate(date, { dateStyle: 'medium', timeStyle: 'short' });
    },
    [formatDate]
  );
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
  const { t } = useTranslation('msp/workflows');
  const formatDateTime = useFormatDateTime();
  const formatWorkflowEventStatus = useFormatWorkflowEventStatus();
  const workflowEventStatusOptions = useWorkflowEventStatusOptions();
  const [filters, setFilters] = useState<EventFilters>(DEFAULT_FILTERS);
  const [appliedFilters, setAppliedFilters] = useState<EventFilters>(DEFAULT_FILTERS);
  const [events, setEvents] = useState<WorkflowEventRecord[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [summary, setSummary] = useState<WorkflowEventSummary | null>(null);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [eventDetail, setEventDetail] = useState<WorkflowEventDetailResponse | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const handleRunDetailsClose = useCallback(() => setSelectedRunId(null), []);
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 25;
  const [totalItems, setTotalItems] = useState(0);
  const [sortBy, setSortBy] = useState<WorkflowEventSortBy>('created_at');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  const statusOptions = useMemo<SelectOption[]>(
    () => [
      {
        value: 'all',
        label: t('filters.allStatuses', { defaultValue: 'All statuses' }),
      },
      ...workflowEventStatusOptions,
    ],
    [t, workflowEventStatusOptions]
  );

  const fetchEvents = useCallback(
    async (override?: {
      page?: number;
      sortBy?: WorkflowEventSortBy;
      sortDirection?: 'asc' | 'desc';
      filters?: EventFilters;
    }) => {
      const activeFilters = override?.filters ?? appliedFilters;
      const page = override?.page ?? currentPage;
      const nextSortBy = override?.sortBy ?? sortBy;
      const nextSortDirection = override?.sortDirection ?? sortDirection;
      setIsLoading(true);
      try {
        const data = await listWorkflowEventsPagedAction({
          eventName: activeFilters.eventName || undefined,
          correlationKey: activeFilters.correlationKey || undefined,
          status: activeFilters.status || 'all',
          from: activeFilters.from || undefined,
          to: activeFilters.to || undefined,
          page,
          pageSize,
          sortBy: nextSortBy,
          sortDirection: nextSortDirection
        });
        setEvents((data as any)?.items ?? []);
        setTotalItems(Number((data as any)?.totalItems ?? 0));
      } catch (error) {
        toast.error(mapWorkflowServerError(t, error, t('eventList.toasts.loadEventsFailed', {
          defaultValue: 'Failed to load workflow events',
        })));
      } finally {
        setIsLoading(false);
      }
    },
    [appliedFilters, currentPage, sortBy, sortDirection, t]
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
      toast.error(mapWorkflowServerError(t, error, t('eventList.toasts.loadEventDetailFailed', {
        defaultValue: 'Failed to load event detail',
      })));
      setEventDetail(null);
      setSelectedRunId(null);
    } finally {
      setDetailLoading(false);
    }
  }, [t]);

  useEffect(() => {
    if (!isActive) return;
    setCurrentPage(1);
    fetchEvents({ page: 1, filters: appliedFilters });
    fetchSummary(appliedFilters);
  }, [appliedFilters, fetchEvents, fetchSummary, isActive]);

  useEffect(() => {
    if (!selectedEventId) {
      setEventDetail(null);
      return;
    }
    fetchEventDetail(selectedEventId);
  }, [fetchEventDetail, selectedEventId]);

  const handleApplyFilters = () => {
    setCurrentPage(1);
    setAppliedFilters(filters);
    fetchEvents({ page: 1, filters });
    fetchSummary(filters);
  };

  const handleResetFilters = () => {
    setFilters(DEFAULT_FILTERS);
    setAppliedFilters(DEFAULT_FILTERS);
    setCurrentPage(1);
    fetchEvents({ page: 1, filters: DEFAULT_FILTERS });
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
      toast.success(t('eventList.toasts.exportReady', { defaultValue: 'Event export ready' }));
    } catch (error) {
      toast.error(mapWorkflowServerError(t, error, t('eventList.toasts.exportFailed', {
        defaultValue: 'Failed to export events',
      })));
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

  const columns: ColumnDefinition<WorkflowEventRecord>[] = useMemo(() => {
    return [
      {
        title: t('eventList.table.columns.event', { defaultValue: 'Event' }),
        dataIndex: 'event_name',
        sortable: true,
        render: (value: unknown, record: WorkflowEventRecord) => (
          <div className="min-w-0">
            <div className="font-medium text-[rgb(var(--color-text-900))] truncate">{record.event_name}</div>
          </div>
        )
      },
      {
        title: t('eventList.table.columns.correlation', { defaultValue: 'Correlation' }),
        dataIndex: 'correlation_key',
        sortable: true,
        width: '160px',
        render: (value: unknown, record: WorkflowEventRecord) => (
          <div className="font-mono text-xs truncate">{record.correlation_key ?? t('eventList.common.emptyValue', { defaultValue: '—' })}</div>
        )
      },
      {
        title: t('eventList.table.columns.schema', { defaultValue: 'Schema' }),
        dataIndex: 'payload_schema_ref',
        sortable: false,
        width: '220px',
        render: (value: unknown, record: WorkflowEventRecord) => (
            <div className="text-[11px] text-[rgb(var(--color-text-600))] max-w-[260px]">
              <div className="font-mono truncate">{record.payload_schema_ref ?? t('eventList.common.emptyValue', { defaultValue: '—' })}</div>
              {record.schema_ref_conflict && (
              <div className="text-[10px] text-[rgb(var(--color-warning-600))]">
                {t('eventList.table.schemaConflict', { defaultValue: 'catalog ≠ submission' })}
              </div>
            )}
          </div>
        )
      },
      {
        title: t('eventList.table.columns.status', { defaultValue: 'Status' }),
        dataIndex: 'status',
        sortable: true,
        width: '120px',
        render: (value: unknown, record: WorkflowEventRecord) => (
          <Badge variant={EVENT_STATUS_VARIANTS[record.status]}>
            {formatWorkflowEventStatus(record.status)}
          </Badge>
        )
      },
      {
        title: t('eventList.table.columns.matchedRun', { defaultValue: 'Matched Run' }),
        dataIndex: 'matched_run_id',
        sortable: false,
        width: '160px',
        render: (value: unknown, record: WorkflowEventRecord) => (
          <div className="font-mono text-xs truncate">{record.matched_run_id ?? t('eventList.common.emptyValue', { defaultValue: '—' })}</div>
        )
      },
      {
        title: t('eventList.table.columns.payload', { defaultValue: 'Payload' }),
        dataIndex: 'payload',
        sortable: false,
        render: (value: unknown, record: WorkflowEventRecord) => (
          <div className="text-xs text-[rgb(var(--color-text-600))] max-w-[220px] truncate">
            {payloadPreview(record.payload)}
          </div>
        )
      },
      {
        title: t('eventList.table.columns.created', { defaultValue: 'Created' }),
        dataIndex: 'created_at',
        sortable: true,
        width: '180px',
        render: (value: unknown, record: WorkflowEventRecord) => (
          <div className="truncate">{formatDateTime(record.created_at)}</div>
        )
      }
    ];
  }, [formatWorkflowEventStatus, t]);

  return (
    <div className="flex h-full gap-4">
      <div className="flex-1 min-h-0 flex flex-col gap-3">
        <Card className="p-4 space-y-3">
          {summary && (
            <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500">
              <span>{t('eventList.summary.total', { defaultValue: 'Total' })}: {summary.total}</span>
              <Badge variant="success">{t('eventList.summary.matched', { defaultValue: 'Matched' })}: {summary.matched}</Badge>
              <Badge variant="warning">{t('eventList.summary.unmatched', { defaultValue: 'Unmatched' })}: {summary.unmatched}</Badge>
              <Badge variant="error">{t('eventList.summary.errors', { defaultValue: 'Errors' })}: {summary.error}</Badge>
            </div>
          )}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Input
              id="workflow-events-name"
              label={t('eventList.filters.eventNameLabel', { defaultValue: 'Event name' })}
              value={filters.eventName}
              onChange={(event) => setFilters((prev) => ({ ...prev, eventName: event.target.value }))}
              placeholder={t('eventList.filters.eventNamePlaceholder', { defaultValue: 'workflow.event' })}
            />
            <Input
              id="workflow-events-correlation"
              label={t('eventList.filters.correlationKeyLabel', { defaultValue: 'Correlation key' })}
              value={filters.correlationKey}
              onChange={(event) => setFilters((prev) => ({ ...prev, correlationKey: event.target.value }))}
              placeholder={t('eventList.filters.correlationKeyPlaceholder', { defaultValue: 'corr-123' })}
            />
            <CustomSelect
              id="workflow-events-status"
              label={t('eventList.filters.statusLabel', { defaultValue: 'Status' })}
              options={statusOptions}
              value={filters.status}
              onValueChange={(value) => setFilters((prev) => ({ ...prev, status: value }))}
            />
            <Input
              id="workflow-events-from"
              label={t('eventList.filters.fromLabel', { defaultValue: 'From' })}
              type="date"
              value={filters.from}
              onChange={(event) => setFilters((prev) => ({ ...prev, from: event.target.value }))}
            />
            <Input
              id="workflow-events-to"
              label={t('eventList.filters.toLabel', { defaultValue: 'To' })}
              type="date"
              value={filters.to}
              onChange={(event) => setFilters((prev) => ({ ...prev, to: event.target.value }))}
            />
          </div>
          <div className="flex items-center gap-2">
            <Button id="workflow-events-apply" onClick={handleApplyFilters} disabled={isLoading}>
              {t('eventList.actions.applyFilters', { defaultValue: 'Apply filters' })}
            </Button>
            <Button id="workflow-events-reset" variant="outline" onClick={handleResetFilters} disabled={isLoading}>
              {t('eventList.actions.reset', { defaultValue: 'Reset' })}
            </Button>
            <Button id="workflow-events-export-csv" variant="outline" onClick={() => handleExport('csv')}>
              {t('eventList.actions.exportCsv', { defaultValue: 'Export CSV' })}
            </Button>
            <Button id="workflow-events-export-json" variant="outline" onClick={() => handleExport('json')}>
              {t('eventList.actions.exportJson', { defaultValue: 'Export JSON' })}
            </Button>
          </div>
        </Card>

        <Card className="p-4 flex-1 min-h-0 overflow-y-auto">
          {isLoading && <div className="text-sm text-gray-500 py-2">{t('eventList.states.loading', { defaultValue: 'Loading events...' })}</div>}

          {!isLoading && events.length === 0 && (
            <div className="text-center text-sm text-gray-500 py-6">{t('eventList.states.empty', { defaultValue: 'No workflow events found.' })}</div>
          )}

          <DataTable
            id="workflow-events-table"
            data={events}
            columns={columns}
            pagination={true}
            currentPage={currentPage}
            onPageChange={(page) => {
              setCurrentPage(page);
              fetchEvents({ page });
            }}
            pageSize={pageSize}
            totalItems={totalItems}
            onRowClick={(row) => setSelectedEventId((row as WorkflowEventRecord).event_id)}
            rowClassName={(row) =>
              (row as WorkflowEventRecord).event_id === selectedEventId
                ? 'bg-table-selected'
                : ''
            }
            manualSorting={true}
            sortBy={sortBy}
            sortDirection={sortDirection}
            onSortChange={(nextSortBy, nextSortDirection) => {
              setSortBy(nextSortBy as WorkflowEventSortBy);
              setSortDirection(nextSortDirection);
              setCurrentPage(1);
              fetchEvents({ page: 1, sortBy: nextSortBy as WorkflowEventSortBy, sortDirection: nextSortDirection });
            }}
          />
        </Card>
      </div>

      {selectedEventId && (
        <div className="w-[480px] shrink-0 overflow-auto space-y-4">
          <Card id="workflow-event-detail-panel" className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold">{t('eventList.detail.title', { defaultValue: 'Event Detail' })}</div>
              <Button id="workflow-event-detail-close" variant="ghost" onClick={() => setSelectedEventId(null)}>
                {t('eventList.actions.close', { defaultValue: 'Close' })}
              </Button>
            </div>
            {detailLoading && <div className="text-sm text-gray-500">{t('eventList.detail.loading', { defaultValue: 'Loading event detail...' })}</div>}
            {!detailLoading && eventDetail && (
              <>
                <div className="text-xs text-gray-500">{t('eventList.detail.eventIdLabel', { defaultValue: 'Event ID' })}</div>
                <div id="workflow-event-detail-event-id" className="text-xs font-mono">
                  {eventDetail.event.event_id}
                </div>
                <div className="text-xs text-gray-500">{t('eventList.detail.statusLabel', { defaultValue: 'Status' })}</div>
                <Badge
                  id="workflow-event-detail-status"
                  variant={EVENT_STATUS_VARIANTS[eventDetail.event.status]}
                >
                  {formatWorkflowEventStatus(eventDetail.event.status)}
                </Badge>
                <div className="text-xs text-gray-500">{t('eventList.detail.eventNameLabel', { defaultValue: 'Event name' })}</div>
                <div className="text-sm">{eventDetail.event.event_name}</div>
                <div className="text-xs text-gray-500">{t('eventList.detail.correlationKeyLabel', { defaultValue: 'Correlation key' })}</div>
                <div id="workflow-event-detail-correlation" className="text-sm font-mono">
                  {eventDetail.event.correlation_key ?? t('eventList.common.emptyValue', { defaultValue: '—' })}
                </div>
                <div className="text-xs text-gray-500">{t('eventList.detail.payloadSchemaRefLabel', { defaultValue: 'Payload schema ref' })}</div>
                <div className="text-sm font-mono break-all">
                  {eventDetail.event.payload_schema_ref ?? t('eventList.common.emptyValue', { defaultValue: '—' })}
                </div>
                {eventDetail.event.schema_ref_conflict && (
                  <div className="rounded border border-warning/30 bg-warning/10 p-2 text-[11px] text-warning-foreground">
                    {t('eventList.detail.schemaConflict', {
                      defaultValue: 'Schema ref conflict: catalog {{catalog}} vs submission {{submission}}',
                      catalog: eventDetail.event.schema_ref_conflict.catalog,
                      submission: eventDetail.event.schema_ref_conflict.submission,
                    })}
                  </div>
                )}
                <div className="text-xs text-gray-500">{t('eventList.detail.createdLabel', { defaultValue: 'Created' })}</div>
                <div className="text-sm">{formatDateTime(eventDetail.event.created_at)}</div>
                <div className="text-xs text-gray-500">{t('eventList.detail.processedLabel', { defaultValue: 'Processed' })}</div>
                <div className="text-sm">{formatDateTime(eventDetail.event.processed_at ?? null)}</div>
                {eventDetail.event.error_message && (
                  <div className="text-sm text-destructive">{t('eventList.detail.errorLine', {
                    defaultValue: 'Error: {{message}}',
                    message: eventDetail.event.error_message,
                  })}</div>
                )}
                {eventDetail.wait && (
                  <div className="space-y-1">
                    <div className="text-xs text-gray-500">{t('eventList.detail.waitLabel', { defaultValue: 'Wait' })}</div>
                    <div id="workflow-event-detail-wait-id" className="text-xs font-mono">
                      {t('eventList.detail.waitIdLine', { defaultValue: 'Wait ID: {{waitId}}', waitId: eventDetail.wait.wait_id })}
                    </div>
                    <div id="workflow-event-detail-wait-status" className="text-xs">
                      {t('eventList.detail.waitStatusLine', { defaultValue: 'Status: {{status}}', status: eventDetail.wait.status })}
                    </div>
                    <div className="text-xs">{t('eventList.detail.waitTimeoutLine', { defaultValue: 'Timeout: {{value}}', value: formatDateTime(eventDetail.wait.timeout_at ?? null) })}</div>
                    <div className="text-xs">{t('eventList.detail.waitResolvedLine', { defaultValue: 'Resolved: {{value}}', value: formatDateTime(eventDetail.wait.resolved_at ?? null) })}</div>
                    <div className="text-xs">{t('eventList.detail.waitStepLine', { defaultValue: 'Step: {{value}}', value: eventDetail.wait.step_path ?? t('eventList.common.emptyValue', { defaultValue: '—' }) })}</div>
                  </div>
                )}
                {eventDetail.run && (
                  <div className="space-y-2">
                    <div className="text-xs text-gray-500">{t('eventList.detail.matchedRunLabel', { defaultValue: 'Matched run' })}</div>
                    <div id="workflow-event-detail-run-id" className="text-xs font-mono">
                      {eventDetail.run.run_id}
                    </div>
                    <div id="workflow-event-detail-run-status" className="text-xs">
                      {t('eventList.detail.runStatusLine', { defaultValue: 'Status: {{status}}', status: eventDetail.run.status })}
                    </div>
                    <Button
                      id="workflow-event-view-run"
                      variant="outline"
                      onClick={() => setSelectedRunId(eventDetail.run?.run_id ?? null)}
                    >
                      {t('eventList.actions.viewRunDetails', { defaultValue: 'View run details' })}
                    </Button>
                  </div>
                )}
                <TextArea
                  id="workflow-event-payload"
                  label={t('eventList.detail.payloadLabel', { defaultValue: 'Payload' })}
                  value={detailPayload}
                  readOnly
                  rows={8}
                  className="font-mono text-xs"
                />
              </>
            )}
          </Card>

          {selectedRunId && (
            <WorkflowRunDetailsPanel
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
