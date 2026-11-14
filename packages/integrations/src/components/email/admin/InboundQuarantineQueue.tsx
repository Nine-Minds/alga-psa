'use client';

/**
 * MSP queue of quarantined inbound email (admin-only; actions enforce
 * ticket_settings:update). Lists inbound_email_quarantine rows with filters and
 * a Dismiss action. Uses the standard DataTable / CustomSelect / Badge / Button.
 * Rows carry no message bodies; the matched ticket renders as its NUMBER, never
 * a raw id.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import toast from 'react-hot-toast';
import { useTranslation, useFormatters } from '@alga-psa/ui/lib/i18n/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { Badge } from '@alga-psa/ui/components/Badge';
import { Button } from '@alga-psa/ui/components/Button';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import type { ColumnDefinition } from '@alga-psa/types';
import { getErrorMessage, isActionMessageError, isActionPermissionError } from '@alga-psa/ui/lib/errorHandling';
import {
  QUARANTINE_REASONS,
  QUARANTINE_STATUSES,
  type QuarantineReason,
  type QuarantineStatus,
} from '@alga-psa/shared/services/email/inboundQuarantineConstants';
import {
  dismissInboundQuarantine,
  listInboundQuarantine,
  type InboundQuarantineListResult,
  type InboundQuarantineRow,
} from '../../../actions/email-actions/inboundQuarantineActions';

const ALL = '__all__';
const DEFAULT_PAGE_SIZE = 25;

export interface InboundQuarantineQueueProps {
  /** Pre-filter to one ticket (the ticket banner links here). */
  initialTicketId?: string;
  initialStatus?: QuarantineStatus;
}

export function InboundQuarantineQueue({ initialTicketId, initialStatus = 'open' }: InboundQuarantineQueueProps) {
  const { t } = useTranslation('msp/email-providers');
  const { formatDate } = useFormatters();
  const [data, setData] = useState<InboundQuarantineListResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [providerId, setProviderId] = useState<string>(ALL);
  const [reason, setReason] = useState<string>(ALL);
  const [status, setStatus] = useState<string>(initialStatus);
  const [ticketId, setTicketId] = useState<string | undefined>(initialTicketId);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await listInboundQuarantine({
        providerId: providerId === ALL ? undefined : providerId,
        reason: reason === ALL ? undefined : (reason as QuarantineReason),
        status: status === ALL ? undefined : (status as QuarantineStatus),
        ticketId,
        page,
        pageSize,
      });
      if (isActionPermissionError(result) || isActionMessageError(result)) {
        setError(getErrorMessage(result));
        setData(null);
      } else {
        setData(result as InboundQuarantineListResult);
      }
    } catch (err) {
      setError(getErrorMessage(err) || t('quarantine.loadError', { defaultValue: 'Failed to load quarantined email' }));
    } finally {
      setLoading(false);
    }
  }, [providerId, reason, status, ticketId, page, pageSize, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const dismiss = useCallback(async (row: InboundQuarantineRow) => {
    setBusyId(row.id);
    try {
      const result = await dismissInboundQuarantine(row.id);
      if (isActionPermissionError(result) || isActionMessageError(result)) {
        toast.error(getErrorMessage(result));
        return;
      }
      toast.success(t('quarantine.dismissed', { defaultValue: 'Entry dismissed' }));
      await load();
    } catch (err) {
      toast.error(getErrorMessage(err) || t('quarantine.dismissError', { defaultValue: 'Failed to dismiss entry' }));
    } finally {
      setBusyId(null);
    }
  }, [load, t]);

  const reasonLabel = useCallback(
    (value: string) => t(`quarantine.reasons.${value}`, { defaultValue: value }),
    [t]
  );

  const mailboxOptions = useMemo(() => [
    { value: ALL, label: t('quarantine.filters.allMailboxes', { defaultValue: 'All mailboxes' }) },
    ...(data?.mailboxes ?? []).map((m) => ({ value: m.providerId, label: m.mailbox || m.providerId })),
  ], [data?.mailboxes, t]);
  const reasonOptions = useMemo(() => [
    { value: ALL, label: t('quarantine.filters.allReasons', { defaultValue: 'All reasons' }) },
    ...QUARANTINE_REASONS.map((value) => ({ value, label: reasonLabel(value) })),
  ], [reasonLabel, t]);
  const statusOptions = useMemo(() => [
    { value: ALL, label: t('quarantine.filters.allStatuses', { defaultValue: 'All statuses' }) },
    ...QUARANTINE_STATUSES.map((value) => ({ value, label: t(`quarantine.status.${value}`, { defaultValue: value }) })),
  ], [t]);

  const columns: ColumnDefinition<InboundQuarantineRow>[] = useMemo(() => [
    { title: t('quarantine.columns.mailbox', { defaultValue: 'Mailbox' }), dataIndex: 'mailbox', sortable: false },
    { title: t('quarantine.columns.sender', { defaultValue: 'Sender' }), dataIndex: 'sender', sortable: false },
    {
      title: t('quarantine.columns.subject', { defaultValue: 'Subject' }),
      dataIndex: 'subject',
      sortable: false,
      render: (value: string) => value || t('quarantine.noSubject', { defaultValue: '(no subject)' }),
    },
    {
      title: t('quarantine.columns.reason', { defaultValue: 'Reason' }),
      dataIndex: 'reason',
      sortable: false,
      render: (value: string) => <Badge variant="warning">{reasonLabel(value)}</Badge>,
    },
    {
      title: t('quarantine.columns.ticket', { defaultValue: 'Ticket' }),
      dataIndex: 'ticketNumber',
      sortable: false,
      render: (_value: unknown, row: InboundQuarantineRow) => row.ticketId && row.ticketNumber
        ? <Link href={`/msp/tickets/${row.ticketId}`} className="text-[rgb(var(--color-primary-600))] hover:underline">{row.ticketNumber}</Link>
        : <span>—</span>,
    },
    {
      title: t('quarantine.columns.received', { defaultValue: 'Received' }),
      dataIndex: 'receivedAt',
      sortable: false,
      render: (value: string) => formatDate(value, { dateStyle: 'medium', timeStyle: 'short' }),
    },
    {
      title: t('quarantine.columns.status', { defaultValue: 'Status' }),
      dataIndex: 'status',
      sortable: false,
      render: (value: string) => (
        <Badge variant={value === 'open' ? 'error' : 'secondary'}>{t(`quarantine.status.${value}`, { defaultValue: value })}</Badge>
      ),
    },
    {
      title: t('quarantine.columns.actions', { defaultValue: 'Actions' }),
      dataIndex: 'id',
      sortable: false,
      render: (_value: unknown, row: InboundQuarantineRow) => row.status === 'open' ? (
        <Button
          id={`inbound-quarantine-dismiss-${row.id}`}
          variant="outline"
          size="sm"
          disabled={busyId === row.id}
          onClick={() => void dismiss(row)}
        >
          {t('quarantine.dismiss', { defaultValue: 'Dismiss' })}
        </Button>
      ) : null,
    },
  ], [busyId, dismiss, formatDate, reasonLabel, t]);

  const onFilter = (setter: (v: string) => void) => (value: string) => {
    setter(value);
    setPage(1);
  };

  return (
    <Card id="inbound-quarantine-queue">
      <CardHeader>
        <CardTitle>{t('quarantine.title', { defaultValue: 'Quarantined inbound email' })}</CardTitle>
        <CardDescription>
          {t('quarantine.description', {
            defaultValue: 'Inbound messages that were refused instead of being added to a ticket. Review them and dismiss what you have handled.',
          })}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <CustomSelect
            id="inbound-quarantine-filter-mailbox"
            label={t('quarantine.filters.mailbox', { defaultValue: 'Mailbox' })}
            options={mailboxOptions}
            value={providerId}
            onValueChange={onFilter(setProviderId)}
          />
          <CustomSelect
            id="inbound-quarantine-filter-reason"
            label={t('quarantine.filters.reason', { defaultValue: 'Reason' })}
            options={reasonOptions}
            value={reason}
            onValueChange={onFilter(setReason)}
          />
          <CustomSelect
            id="inbound-quarantine-filter-status"
            label={t('quarantine.filters.status', { defaultValue: 'Status' })}
            options={statusOptions}
            value={status}
            onValueChange={onFilter(setStatus)}
          />
          {ticketId ? (
            <Button
              id="inbound-quarantine-clear-ticket"
              variant="outline"
              onClick={() => { setTicketId(undefined); setPage(1); }}
            >
              {t('quarantine.filters.clearTicket', { defaultValue: 'Show all tickets' })}
            </Button>
          ) : null}
        </div>

        {error ? (
          <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>
        ) : null}

        <DataTable
          id="inbound-quarantine-table"
          data={data?.rows ?? []}
          columns={columns}
          pagination
          currentPage={page}
          pageSize={pageSize}
          totalItems={data?.total ?? 0}
          onPageChange={setPage}
          onItemsPerPageChange={(size) => { setPageSize(size); setPage(1); }}
        />
        {!loading && !error && (data?.rows.length ?? 0) === 0 ? (
          <p className="text-sm text-[rgb(var(--color-text-500))]">
            {t('quarantine.empty', { defaultValue: 'No quarantined email match these filters.' })}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

export default InboundQuarantineQueue;

