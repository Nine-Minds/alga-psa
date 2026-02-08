'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Card } from '@alga-psa/ui/components/Card';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import { Input } from '@alga-psa/ui/components/Input';
import { Button } from '@alga-psa/ui/components/Button';
import { Dialog, DialogContent, DialogFooter, DialogHeader } from '@alga-psa/ui/components/Dialog';
import {
  getEmailLogMetrics,
  getEmailLogs,
  type EmailLogFilters,
  type EmailLogMetrics,
  type EmailSendingLogListRecord
} from '@alga-psa/email/actions';
import type { ColumnDefinition } from '@alga-psa/types';

type EmailLogsClientProps = {
  initialMetrics?: EmailLogMetrics;
  initialLogs?: {
    data: EmailSendingLogListRecord[];
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
  };
};

const EMPTY_METRICS: EmailLogMetrics = {
  total: 0,
  failed: 0,
  today: 0,
  failedRate: 0,
};

const EMPTY_LOGS: NonNullable<EmailLogsClientProps['initialLogs']> = {
  data: [],
  total: 0,
  page: 1,
  pageSize: 50,
  totalPages: 0,
};

function parseEmailList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => String(item)).filter(Boolean);
  }
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (Array.isArray(parsed)) {
        return parsed.map((item) => String(item)).filter(Boolean);
      }
    } catch {
      // ignore
    }
    return value ? [value] : [];
  }
  return [];
}

function formatSentAt(value: unknown): string {
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) {
    return '—';
  }
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: '2-digit',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

export default function EmailLogsClient({ initialMetrics, initialLogs }: EmailLogsClientProps) {
  const seedLogs = initialLogs ?? EMPTY_LOGS;
  const [metrics, setMetrics] = useState<EmailLogMetrics>(initialMetrics ?? EMPTY_METRICS);
  const [logs, setLogs] = useState(seedLogs.data);
  const [total, setTotal] = useState(seedLogs.total);
  const [page, setPage] = useState(seedLogs.page);
  const [pageSize, setPageSize] = useState(seedLogs.pageSize);
  const [sortBy, setSortBy] = useState<NonNullable<EmailLogFilters['sortBy']>>('sent_at');
  const [sortDirection, setSortDirection] = useState<NonNullable<EmailLogFilters['sortDirection']>>('desc');

  const [status, setStatus] = useState<string>('');
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');
  const [recipientEmail, setRecipientEmail] = useState<string>('');
  const [ticketNumber, setTicketNumber] = useState<string>('');

  const [isLoading, setIsLoading] = useState(false);
  const [selected, setSelected] = useState<EmailSendingLogListRecord | null>(null);
  const hasInitializedTextFilterEffect = useRef(false);
  const hasInitializedDiscreteFilterEffect = useRef(false);

  const fetchMetrics = useCallback(async () => {
    const result = await getEmailLogMetrics();
    setMetrics(result);
  }, []);

  const fetchLogs = useCallback(
    async (next: Partial<EmailLogFilters> = {}) => {
      setIsLoading(true);
      try {
        const result = await getEmailLogs({
          page,
          pageSize,
          sortBy,
          sortDirection,
          startDate: startDate || undefined,
          endDate: endDate || undefined,
          status: status ? (status as any) : undefined,
          recipientEmail: recipientEmail || undefined,
          ticketNumber: ticketNumber || undefined,
          ...next,
        });
        setLogs(result.data);
        setTotal(result.total);
        setPage(result.page);
        setPageSize(result.pageSize);
      } finally {
        setIsLoading(false);
      }
    },
    [page, pageSize, sortBy, sortDirection, startDate, endDate, status, recipientEmail, ticketNumber]
  );

  // Debounce text-based filters to avoid spamming server actions
  useEffect(() => {
    if (!hasInitializedTextFilterEffect.current) {
      hasInitializedTextFilterEffect.current = true;
      return;
    }

    const timer = setTimeout(() => {
      void fetchLogs({ page: 1 });
    }, 300);

    return () => clearTimeout(timer);
  }, [recipientEmail, ticketNumber, fetchLogs]);

  // Immediate refresh for discrete filters
  useEffect(() => {
    if (!hasInitializedDiscreteFilterEffect.current) {
      hasInitializedDiscreteFilterEffect.current = true;
      if (!initialLogs) {
        void fetchLogs({ page: 1 });
      }
      return;
    }

    void fetchLogs({ page: 1 });
  }, [status, startDate, endDate, fetchLogs, initialLogs]);

  useEffect(() => {
    if (initialMetrics) return;
    void fetchMetrics();
  }, [initialMetrics, fetchMetrics]);

  const columns: ColumnDefinition<EmailSendingLogListRecord>[] = useMemo(() => {
    return [
      {
        title: 'Time',
        dataIndex: 'sent_at',
        render: (value) => formatSentAt(value),
      },
      {
        title: 'Ticket',
        dataIndex: 'ticket_number',
        render: (value) => String(value || '—'),
      },
      {
        title: 'Recipient',
        dataIndex: 'to_addresses',
        render: (value) => {
          const list = parseEmailList(value);
          return list[0] || '—';
        },
      },
      {
        title: 'Subject',
        dataIndex: 'subject',
        render: (value) => String(value || '—'),
      },
      {
        title: 'Status',
        dataIndex: 'status',
        render: (value) => {
          const v = String(value || '').toLowerCase();
          const isFailed = v === 'failed';
          const dotClass = isFailed ? 'bg-red-500' : 'bg-emerald-500';
          const label = v ? v : '—';
          return (
            <span className="inline-flex items-center gap-2">
              <span className={`h-2 w-2 rounded-full ${dotClass}`} aria-hidden="true" />
              <span className="capitalize">{label}</span>
            </span>
          );
        },
      },
    ];
  }, []);

  const failedRatePct = Math.round((metrics.failedRate ?? 0) * 100);

  return (
    <div className="space-y-6">
      {/* Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="p-4">
          <div className="text-sm text-[rgb(var(--color-text-500))]">Total sent</div>
          <div className="text-2xl font-semibold text-[rgb(var(--color-text-900))]">{metrics.total}</div>
        </Card>
        <Card className="p-4">
          <div className="text-sm text-[rgb(var(--color-text-500))]">Failed rate</div>
          <div className="text-2xl font-semibold text-[rgb(var(--color-text-900))]">{failedRatePct}%</div>
        </Card>
        <Card className="p-4">
          <div className="text-sm text-[rgb(var(--color-text-500))]">Today</div>
          <div className="text-2xl font-semibold text-[rgb(var(--color-text-900))]">{metrics.today}</div>
        </Card>
      </div>

      {/* Filters + Table */}
      <Card className="p-6">
        <div className="mb-4 flex flex-col gap-3">
          <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
            <Input
              id="email-logs-filter-start-date"
              type="date"
              label="Start date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
            <Input
              id="email-logs-filter-end-date"
              type="date"
              label="End date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
            />
            <div>
              <label className="block text-sm font-medium text-[rgb(var(--color-text-700))] mb-1">Status</label>
              <select
                className="w-full h-10 rounded-md border border-[rgb(var(--color-border-400))] bg-white px-3 text-sm"
                value={status}
                onChange={(e) => setStatus(e.target.value)}
              >
                <option value="">All</option>
                <option value="sent">Sent</option>
                <option value="failed">Failed</option>
              </select>
            </div>
            <Input
              id="email-logs-filter-recipient"
              type="text"
              label="Recipient"
              placeholder="Search email…"
              value={recipientEmail}
              onChange={(e) => setRecipientEmail(e.target.value)}
            />
            <Input
              id="email-logs-filter-ticket"
              type="text"
              label="Ticket"
              placeholder="Ticket #…"
              value={ticketNumber}
              onChange={(e) => setTicketNumber(e.target.value)}
            />
          </div>

          <div className="flex items-center justify-between">
            <div className="text-sm text-[rgb(var(--color-text-500))]">
              {isLoading ? 'Loading…' : `${total} result${total === 1 ? '' : 's'}`}
            </div>
            <Button
              id="email-logs-refresh"
              variant="outline"
              onClick={() => {
                void fetchLogs({ page: 1 });
                void fetchMetrics();
              }}
              disabled={isLoading}
            >
              Refresh
            </Button>
          </div>
        </div>

        <DataTable
          id="email-logs-table"
          data={logs}
          columns={columns}
          currentPage={page}
          pageSize={pageSize}
          totalItems={total}
          onPageChange={(nextPage) => {
            setPage(nextPage);
            void fetchLogs({ page: nextPage });
          }}
          onItemsPerPageChange={(nextSize) => {
            setPageSize(nextSize);
            setPage(1);
            void fetchLogs({ page: 1, pageSize: nextSize });
          }}
          manualSorting
          sortBy={sortBy}
          sortDirection={sortDirection}
          onSortChange={(nextSortBy, nextDirection) => {
            setSortBy(nextSortBy as any);
            setSortDirection(nextDirection);
            setPage(1);
            void fetchLogs({ page: 1, sortBy: nextSortBy as any, sortDirection: nextDirection });
          }}
          onRowClick={(record) => setSelected(record)}
        />
      </Card>

      <Dialog
        id="email-log-detail"
        isOpen={Boolean(selected)}
        onClose={() => setSelected(null)}
        title="Email Log Details"
        draggable={false}
      >
        <DialogHeader>
          <div className="text-sm text-[rgb(var(--color-text-500))]">{selected?.subject || 'No subject'}</div>
        </DialogHeader>
        <DialogContent>
          {selected && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <div className="text-xs text-[rgb(var(--color-text-500))]">Sent at</div>
                  <div className="text-sm text-[rgb(var(--color-text-900))]">{formatSentAt(selected.sent_at)}</div>
                </div>
                <div>
                  <div className="text-xs text-[rgb(var(--color-text-500))]">Status</div>
                  <div className="text-sm text-[rgb(var(--color-text-900))]">{selected.status}</div>
                </div>
                <div>
                  <div className="text-xs text-[rgb(var(--color-text-500))]">Provider</div>
                  <div className="text-sm text-[rgb(var(--color-text-900))]">
                    {selected.provider_type} ({selected.provider_id})
                  </div>
                </div>
                <div>
                  <div className="text-xs text-[rgb(var(--color-text-500))]">Message ID</div>
                  <div className="text-sm text-[rgb(var(--color-text-900))] break-all">
                    {selected.message_id || '—'}
                  </div>
                </div>
                <div className="md:col-span-2">
                  <div className="text-xs text-[rgb(var(--color-text-500))]">To</div>
                  <div className="text-sm text-[rgb(var(--color-text-900))] break-all">
                    {parseEmailList(selected.to_addresses).join(', ') || '—'}
                  </div>
                </div>
                <div className="md:col-span-2">
                  <div className="text-xs text-[rgb(var(--color-text-500))]">From</div>
                  <div className="text-sm text-[rgb(var(--color-text-900))] break-all">{selected.from_address}</div>
                </div>
                {selected.error_message && (
                  <div className="md:col-span-2">
                    <div className="text-xs text-[rgb(var(--color-text-500))]">Error</div>
                    <div className="text-sm text-red-600 break-words">{selected.error_message}</div>
                  </div>
                )}
              </div>

              <div>
                <div className="text-xs text-[rgb(var(--color-text-500))] mb-1">Metadata</div>
                <pre className="text-xs bg-gray-50 border border-gray-200 rounded-md p-3 overflow-auto max-h-72">
                  {JSON.stringify(selected.metadata ?? {}, null, 2)}
                </pre>
              </div>
            </div>
          )}
        </DialogContent>
        <DialogFooter>
          <Button id="email-log-detail-close" variant="outline" onClick={() => setSelected(null)}>
            Close
          </Button>
        </DialogFooter>
      </Dialog>
    </div>
  );
}
