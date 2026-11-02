'use client';

import React from 'react';
import { Clock } from 'lucide-react';
import type { ILateHourlyTimeNotice } from '@alga-psa/types';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import { Badge } from '@alga-psa/ui/components/Badge';
import { useFormatters, useTranslation } from '@alga-psa/ui/lib/i18n/client';

interface LateHourlyTimeNoticesProps {
  notices: ILateHourlyTimeNotice[];
}

/**
 * Approved hourly time dated inside a service period an issued invoice already
 * closed. Entries inside the lookback bill on the next invoice; older ones are
 * listed so an operator can see them, but are not billed.
 */
export function LateHourlyTimeNotices({ notices }: LateHourlyTimeNoticesProps) {
  const { t } = useTranslation('msp/invoicing');
  const { formatDate } = useFormatters();

  if (notices.length === 0) return null;

  const day = (iso: string) => formatDate(iso, { timeZone: 'UTC', year: 'numeric', month: 'short', day: 'numeric' });
  const hours = (minutes: number) => (minutes / 60).toFixed(2);
  const waiting = notices.filter((notice) => notice.disposition === 'next_invoice').length;
  const outside = notices.length - waiting;

  return (
    <Alert variant="info" className="mb-4" data-testid="late-hourly-time-notices">
      <AlertDescription>
        <div className="flex items-start gap-3">
          <Clock className="mt-0.5 h-4 w-4 shrink-0" />
          <div className="w-full space-y-3">
            <h4 className="font-semibold">
              {t('automaticInvoices.lateTime.title', { defaultValue: 'Late approved hourly time' })}
            </h4>
            <p className="text-sm text-muted-foreground">
              {t('automaticInvoices.lateTime.description', {
                defaultValue: 'This time was approved after the invoice for its service period was issued. Entries waiting to bill are added to the next invoice, once, marked as late time. Entries outside the lookback are not billed.',
                waiting,
                outside,
              })}
            </p>
            <DataTable
              id="late-hourly-time-notices-table"
              data={notices}
              pagination={false}
              columns={[
                {
                  title: t('automaticInvoices.lateTime.columns.client', { defaultValue: 'Client' }),
                  dataIndex: 'clientName',
                  render: (value) => (value as string | null) ?? '',
                },
                {
                  title: t('automaticInvoices.lateTime.columns.technician', { defaultValue: 'Technician' }),
                  dataIndex: 'technicianName',
                  render: (value) => (value as string | null) ?? '',
                },
                {
                  title: t('automaticInvoices.lateTime.columns.service', { defaultValue: 'Service' }),
                  dataIndex: 'serviceName',
                  render: (value, record: ILateHourlyTimeNotice) =>
                    [value as string | null, record.workItemLabel].filter(Boolean).join(' · '),
                },
                {
                  title: t('automaticInvoices.lateTime.columns.workDate', { defaultValue: 'Work date' }),
                  dataIndex: 'workDate',
                  render: (value) => day(value as string),
                },
                {
                  title: t('automaticInvoices.lateTime.columns.hours', { defaultValue: 'Hours' }),
                  dataIndex: 'billableMinutes',
                  render: (value) => hours(Number(value)),
                },
                {
                  title: t('automaticInvoices.lateTime.columns.closedPeriod', { defaultValue: 'Closed service period' }),
                  dataIndex: 'closedPeriodStart',
                  render: (_value, record: ILateHourlyTimeNotice) =>
                    `${day(record.closedPeriodStart)} – ${day(record.closedPeriodEnd)}`,
                },
                {
                  title: t('automaticInvoices.lateTime.columns.status', { defaultValue: 'Status' }),
                  dataIndex: 'disposition',
                  render: (value) => value === 'outside_lookback'
                    ? <Badge variant="warning">{t('automaticInvoices.lateTime.outsideLookback', { defaultValue: 'Outside lookback — not billed' })}</Badge>
                    : <Badge variant="info">{t('automaticInvoices.lateTime.nextInvoice', { defaultValue: 'Bills on next invoice' })}</Badge>,
                },
              ]}
            />
          </div>
        </div>
      </AlertDescription>
    </Alert>
  );
}

export default LateHourlyTimeNotices;
