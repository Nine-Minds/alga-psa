'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { XCircle } from 'lucide-react';
import { Button } from '@alga-psa/ui/components/Button';
import { Card } from '@alga-psa/ui/components/Card';
import { SearchInput } from '@alga-psa/ui/components/SearchInput';
import { DatePicker } from '@alga-psa/ui/components/DatePicker';
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

type WorkflowEventQuery = {
  eventName: string;
  correlationKey: string;
  status: string;
  from: string;
  to: string;
  page: number;
  pageSize: number;
  sortBy: WorkflowEventSortBy;
  sortDirection: 'asc' | 'desc';
};

const EVENT_STATUS_VARIANTS: Record<WorkflowEventRecord['status'], 'success' | 'warning' | 'error'> = {
  matched: 'success',
  unmatched: 'warning',
  error: 'error'
};

const DEFAULT_QUERY: WorkflowEventQuery = {
  eventName: '',
  correlationKey: '',
  status: 'all',
  from: '',
  to: '',
  page: 1,
  pageSize: 25,
  sortBy: 'created_at',
  sortDirection: 'desc'
};

const FILTER_DEBOUNCE_MS = 300;

// DatePicker works in Date objects; the query/server contract stays 'YYYY-MM-DD' strings.
// Parse/format in local time so the calendar day round-trips regardless of timezone.
const parseIsoDate = (value: string): Date | undefined => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return undefined;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(date.getTime()) ? undefined : date;
};

const formatIsoDate = (value: Date | undefined): string => {
  if (!value) return '';
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
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

  // Single source of truth for everything that drives a fetch (filters, sort, page).
  const [query, setQuery] = useState<WorkflowEventQuery>(DEFAULT_QUERY);
  // Local, immediate text-input state; debounced into `query` so typing stays responsive.
  const [eventNameInput, setEventNameInput] = useState('');
  const [correlationKeyInput, setCorrelationKeyInput] = useState('');

  const [events, setEvents] = useState<WorkflowEventRecord[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [summary, setSummary] = useState<WorkflowEventSummary | null>(null);
  const [totalItems, setTotalItems] = useState(0);

  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [eventDetail, setEventDetail] = useState<WorkflowEventDetailResponse | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const handleRunDetailsClose = useCallback(() => setSelectedRunId(null), []);

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

  const hasActiveFilters =
    query.eventName !== '' ||
    query.correlationKey !== '' ||
    query.status !== 'all' ||
    query.from !== '' ||
    query.to !== '';

  // Debounce the text filters into the query (and reset to page 1) without blocking keystrokes.
  useEffect(() => {
    const handle = setTimeout(() => {
      setQuery((prev) => {
        if (prev.eventName === eventNameInput && prev.correlationKey === correlationKeyInput) {
          return prev;
        }
        return { ...prev, eventName: eventNameInput, correlationKey: correlationKeyInput, page: 1 };
      });
    }, FILTER_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [eventNameInput, correlationKeyInput]);

  // One effect owns the event list. It re-runs whenever any query field changes — filters,
  // sort, and pagination all flow through here, so they never fight each other.
  useEffect(() => {
    if (!isActive) return;
    let cancelled = false;
    setIsLoading(true);
    listWorkflowEventsPagedAction({
      eventName: query.eventName || undefined,
      correlationKey: query.correlationKey || undefined,
      status: query.status || 'all',
      from: query.from || undefined,
      to: query.to || undefined,
      page: query.page,
      pageSize: query.pageSize,
      sortBy: query.sortBy,
      sortDirection: query.sortDirection
    })
      .then((data) => {
        if (cancelled) return;
        setEvents((data as any)?.items ?? []);
        setTotalItems(Number((data as any)?.totalItems ?? 0));
      })
      .catch((error) => {
        if (cancelled) return;
        toast.error(mapWorkflowServerError(t, error, t('eventList.toasts.loadEventsFailed', {
          defaultValue: 'Failed to load workflow events',
        })));
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [
    isActive,
    query.eventName,
    query.correlationKey,
    query.status,
    query.from,
    query.to,
    query.page,
    query.pageSize,
    query.sortBy,
    query.sortDirection,
    t
  ]);

  // Summary is a breakdown of every status, so it ignores the status filter and pagination.
  useEffect(() => {
    if (!isActive) return;
    let cancelled = false;
    listWorkflowEventSummaryAction({
      eventName: query.eventName || undefined,
      correlationKey: query.correlationKey || undefined,
      from: query.from || undefined,
      to: query.to || undefined
    })
      .then((data) => {
        if (!cancelled) setSummary(data as WorkflowEventSummary);
      })
      .catch(() => {
        if (!cancelled) setSummary(null);
      });
    return () => {
      cancelled = true;
    };
  }, [isActive, query.eventName, query.correlationKey, query.from, query.to]);

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
    if (!selectedEventId) {
      setEventDetail(null);
      return;
    }
    fetchEventDetail(selectedEventId);
  }, [fetchEventDetail, selectedEventId]);

  const handleStatusChange = (value: string) =>
    setQuery((prev) => ({ ...prev, status: value, page: 1 }));

  const handleFromChange = (value: string) =>
    setQuery((prev) => ({ ...prev, from: value, page: 1 }));

  const handleToChange = (value: string) =>
    setQuery((prev) => ({ ...prev, to: value, page: 1 }));

  const handleResetFilters = () => {
    setEventNameInput('');
    setCorrelationKeyInput('');
    setQuery(DEFAULT_QUERY);
  };

  const handleExport = async (format: 'csv' | 'json') => {
    try {
      const result = await exportWorkflowEventsAction({
        format,
        eventName: query.eventName || undefined,
        correlationKey: query.correlationKey || undefined,
        status: query.status !== 'all' ? (query.status as any) : undefined,
        from: query.from || undefined,
        to: query.to || undefined,
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
  }, [formatDateTime, formatWorkflowEventStatus, t]);

  return (
    <div className="flex h-full gap-4">
      <div className="flex-1 min-h-0 flex flex-col gap-3">
        <Card className="p-3 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <SearchInput
              id="workflow-events-name"
              value={eventNameInput}
              onChange={(event) => setEventNameInput(event.target.value)}
              onClear={() => setEventNameInput('')}
              placeholder={t('eventList.filters.eventNamePlaceholder', { defaultValue: 'Event name…' })}
              className="w-56 h-[38px]"
            />
            <SearchInput
              id="workflow-events-correlation"
              value={correlationKeyInput}
              onChange={(event) => setCorrelationKeyInput(event.target.value)}
              onClear={() => setCorrelationKeyInput('')}
              placeholder={t('eventList.filters.correlationKeyPlaceholder', { defaultValue: 'Correlation key…' })}
              className="w-48 h-[38px]"
            />
            <CustomSelect
              id="workflow-events-status"
              options={statusOptions}
              value={query.status}
              onValueChange={handleStatusChange}
              className="min-w-[150px]"
            />
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-[rgb(var(--color-text-500))]">{t('eventList.filters.fromLabel', { defaultValue: 'From' })}</span>
              <DatePicker
                id="workflow-events-from"
                value={parseIsoDate(query.from)}
                onChange={(date) => handleFromChange(formatIsoDate(date))}
                clearable
                placeholder={t('eventList.filters.datePlaceholder', { defaultValue: 'Any date' })}
                className="w-[150px]"
              />
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-[rgb(var(--color-text-500))]">{t('eventList.filters.toLabel', { defaultValue: 'To' })}</span>
              <DatePicker
                id="workflow-events-to"
                value={parseIsoDate(query.to)}
                onChange={(date) => handleToChange(formatIsoDate(date))}
                clearable
                placeholder={t('eventList.filters.datePlaceholder', { defaultValue: 'Any date' })}
                className="w-[150px]"
              />
            </div>
            {hasActiveFilters && (
              <Button
                id="workflow-events-reset"
                variant="ghost"
                size="sm"
                onClick={handleResetFilters}
                className="flex items-center gap-1 text-gray-500 hover:text-gray-700"
              >
                <XCircle className="h-4 w-4" />
                {t('eventList.actions.reset', { defaultValue: 'Reset' })}
              </Button>
            )}
            <div className="ml-auto flex items-center gap-2">
              <Button id="workflow-events-export-csv" variant="outline" size="sm" onClick={() => handleExport('csv')}>
                {t('eventList.actions.exportCsv', { defaultValue: 'Export CSV' })}
              </Button>
              <Button id="workflow-events-export-json" variant="outline" size="sm" onClick={() => handleExport('json')}>
                {t('eventList.actions.exportJson', { defaultValue: 'Export JSON' })}
              </Button>
            </div>
          </div>
          {summary && (
            <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500">
              <span>{t('eventList.summary.total', { defaultValue: 'Total' })}: {summary.total}</span>
              <Badge variant="success">{t('eventList.summary.matched', { defaultValue: 'Matched' })}: {summary.matched}</Badge>
              <Badge variant="warning">{t('eventList.summary.unmatched', { defaultValue: 'Unmatched' })}: {summary.unmatched}</Badge>
              <Badge variant="error">{t('eventList.summary.errors', { defaultValue: 'Errors' })}: {summary.error}</Badge>
            </div>
          )}
        </Card>

        <Card className="p-4 flex-1 min-h-0 overflow-y-auto">
          {isLoading && <div className="text-sm text-gray-500 py-2">{t('eventList.states.loading', { defaultValue: 'Loading events...' })}</div>}

          {!isLoading && events.length === 0 && (
            <div className="text-center text-sm text-gray-500 py-6">{t('eventList.states.empty', { defaultValue: 'No workflow events found.' })}</div>
          )}

          <DataTable
            key={`${query.page}-${query.pageSize}`}
            id="workflow-events-table"
            data={events}
            columns={columns}
            pagination={true}
            currentPage={query.page}
            onPageChange={(page) => setQuery((prev) => ({ ...prev, page }))}
            pageSize={query.pageSize}
            onItemsPerPageChange={(size) => setQuery((prev) => ({ ...prev, pageSize: size, page: 1 }))}
            totalItems={totalItems}
            onRowClick={(row) => setSelectedEventId((row as WorkflowEventRecord).event_id)}
            rowClassName={(row) =>
              (row as WorkflowEventRecord).event_id === selectedEventId
                ? 'bg-table-selected'
                : ''
            }
            manualSorting={true}
            sortBy={query.sortBy}
            sortDirection={query.sortDirection}
            onSortChange={(nextSortBy, nextSortDirection) => {
              setQuery((prev) => ({
                ...prev,
                sortBy: nextSortBy as WorkflowEventSortBy,
                sortDirection: nextSortDirection,
                page: 1
              }));
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
