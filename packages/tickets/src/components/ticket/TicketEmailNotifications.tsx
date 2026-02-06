'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import { Button } from '@alga-psa/ui/components/Button';
import { ReflectionContainer } from '@alga-psa/ui/ui-reflection/ReflectionContainer';
import { withDataAutomationId } from '@alga-psa/ui/ui-reflection/withDataAutomationId';
import { getEmailLogsForTicket, type EmailSendingLogRecord } from '@alga-psa/email/actions';
import type { ColumnDefinition } from '@alga-psa/types';
import styles from './TicketDetails.module.css';

interface TicketEmailNotificationsProps {
  id?: string;
  ticketId: string;
}

const INITIAL_LIMIT = 20;
const LOAD_MORE_STEP = 20;

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

const TicketEmailNotifications: React.FC<TicketEmailNotificationsProps> = ({
  id = 'ticket-email-notifications',
  ticketId,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [logs, setLogs] = useState<EmailSendingLogRecord[]>([]);
  const [limit, setLimit] = useState(INITIAL_LIMIT);
  const [hasMore, setHasMore] = useState(false);

  const fetchLogs = useCallback(async () => {
    if (!ticketId) return;

    setIsLoading(true);
    try {
      const result = await getEmailLogsForTicket(ticketId, { limit: limit + 1 });
      const nextHasMore = result.length > limit;
      setHasMore(nextHasMore);
      setLogs(nextHasMore ? result.slice(0, limit) : result);
    } catch (error) {
      console.error('Error fetching email logs for ticket:', error);
      setLogs([]);
      setHasMore(false);
    } finally {
      setIsLoading(false);
    }
  }, [ticketId, limit]);

  useEffect(() => {
    if (!isOpen) return;
    void fetchLogs();
  }, [isOpen, fetchLogs]);

  const columns: ColumnDefinition<EmailSendingLogRecord>[] = useMemo(() => {
    return [
      {
        title: 'Time',
        dataIndex: 'sent_at',
        render: (value) => formatSentAt(value),
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
      {
        title: 'Error',
        dataIndex: 'error_message',
        render: (value, record) => {
          if (record.status !== 'failed') return '—';
          return String(value || 'Unknown error');
        },
      },
    ];
  }, []);

  return (
    <ReflectionContainer id={id} label="Ticket Email Notifications">
      <div {...withDataAutomationId({ id })} className={styles['card']}>
        <button
          type="button"
          className="w-full p-6 flex items-start justify-between gap-4"
          onClick={() => setIsOpen((prev) => !prev)}
        >
          <div className="text-left">
            <h2 className="text-xl font-bold text-[rgb(var(--color-text-900))]">Email Notifications</h2>
            <p className="text-sm text-[rgb(var(--color-text-500))] mt-1">
              Outbound email notifications sent for this ticket
            </p>
          </div>
          <span className="text-[rgb(var(--color-text-500))] mt-1 select-none">{isOpen ? 'Hide' : 'Show'}</span>
        </button>

        {isOpen && (
          <div className="px-6 pb-6">
            {isLoading ? (
              <div className="text-sm text-[rgb(var(--color-text-500))]">Loading…</div>
            ) : logs.length === 0 ? (
              <div className="text-sm text-[rgb(var(--color-text-500))]">No email notifications found.</div>
            ) : (
              <DataTable id={`${id}-table`} data={logs} columns={columns} pagination={false} />
            )}

            {hasMore && !isLoading && (
              <div className="mt-4 flex justify-center">
                <Button id={`${id}-load-more`} variant="outline" onClick={() => setLimit((prev) => prev + LOAD_MORE_STEP)}>
                  Load more
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
    </ReflectionContainer>
  );
};

export default TicketEmailNotifications;

