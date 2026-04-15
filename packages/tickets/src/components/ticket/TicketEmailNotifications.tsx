'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import { Button } from '@alga-psa/ui/components/Button';
import { ReflectionContainer } from '@alga-psa/ui/ui-reflection/ReflectionContainer';
import { ContentCard } from '@alga-psa/ui/components';
import { getEmailLogsForTicket, type EmailSendingLogRecord } from '@alga-psa/email/actions';
import type { ColumnDefinition } from '@alga-psa/types';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { Mail } from 'lucide-react';

interface TicketEmailNotificationsProps {
  id?: string;
  ticketId: string;
  variant?: 'card' | 'flat';
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

function formatSentAt(value: unknown, locale: string): string {
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) {
    return '—';
  }
  return new Intl.DateTimeFormat(locale, {
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
  variant = 'card',
}) => {
  const { t, i18n } = useTranslation('features/tickets');
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
    void fetchLogs();
  }, [fetchLogs]);

  const columns: ColumnDefinition<EmailSendingLogRecord>[] = useMemo(() => {
    return [
      {
        title: t('emailNotifications.time', 'Time'),
        dataIndex: 'sent_at',
        render: (value) => formatSentAt(value, i18n.language || 'en'),
      },
      {
        title: t('emailNotifications.recipient', 'Recipient'),
        dataIndex: 'to_addresses',
        render: (value) => {
          const list = parseEmailList(value);
          return list[0] || '—';
        },
      },
      {
        title: t('emailNotifications.subject', 'Subject'),
        dataIndex: 'subject',
        render: (value) => String(value || '—'),
      },
      {
        title: t('emailNotifications.status', 'Status'),
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
        title: t('emailNotifications.error', 'Error'),
        dataIndex: 'error_message',
        render: (value, record) => {
          if (record.status !== 'failed') return '—';
          return String(value || t('emailNotifications.unknownError', 'Unknown error'));
        },
      },
    ];
  }, [i18n.language, t]);

  const content = (
    <>
      {isLoading ? (
        <div className="text-sm text-[rgb(var(--color-text-500))]">
          {t('emailNotifications.loading', 'Loading…')}
        </div>
      ) : logs.length === 0 ? (
        <div className="text-sm text-[rgb(var(--color-text-500))]">
          {t('emailNotifications.empty', 'No email notifications found.')}
        </div>
      ) : (
        <DataTable id={`${id}-table`} data={logs} columns={columns} pagination={false} />
      )}

      {hasMore && !isLoading && (
        <div className="mt-4 flex justify-center">
          <Button id={`${id}-load-more`} variant="outline" onClick={() => setLimit((prev) => prev + LOAD_MORE_STEP)}>
            {t('emailNotifications.loadMore', 'Load more')}
          </Button>
        </div>
      )}
    </>
  );

  return (
    <ReflectionContainer id={id} label={t('emailNotifications.title', 'Email Notifications')}>
      {variant === 'flat' ? (
        <div className="space-y-4">{content}</div>
      ) : (
        <ContentCard
          id={id}
          collapsible
          defaultExpanded={false}
          title={t('emailNotifications.title', 'Email Notifications')}
          headerIcon={<Mail className="w-5 h-5" />}
          count={logs.length}
        >
          {content}
        </ContentCard>
      )}
    </ReflectionContainer>
  );
};

export default TicketEmailNotifications;
