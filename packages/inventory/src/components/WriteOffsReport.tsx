'use client';

import React, { useState, useCallback } from 'react';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import { Button } from '@alga-psa/ui/components/Button';
import { DatePicker } from '@alga-psa/ui/components/DatePicker';
import { Label } from '@alga-psa/ui/components/Label';
import { Badge } from '@alga-psa/ui/components/Badge';
import { PrintButton } from '@alga-psa/ui/components/PrintButton';
import { PrintableDetailHeader } from '@alga-psa/ui/components/PrintableDetailHeader';
import { PrintableSummary } from '@alga-psa/ui/components/PrintableSummary';
import { PrintableTable, type PrintableTableColumn } from '@alga-psa/ui/components/PrintableTable';
import { toast } from 'react-hot-toast';
import type { ColumnDefinition } from '@alga-psa/types';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { getErrorMessage, isActionMessageError, isActionPermissionError } from '@alga-psa/ui/lib/errorHandling';
import { useCurrencyFormat } from '@alga-psa/ui/lib';
import { dateFromString, dateToString } from '@alga-psa/ui/lib/dateInput';
import { writeOffReport, type WriteOffReportData, type WriteOffRow, type WriteOffByUser } from '../actions';

/**
 * Owner's write-off review (Sam review P2): every adjustment, retirement, and count
 * correction in a period with who signed it and the dollars — the audit trail for the
 * person who HOLDS the approve button. Signs follow stock: negative = written down.
 */

const dateInputValue = (iso: string): string => iso.slice(0, 10);

export function WriteOffsReport({ initialData }: { initialData: WriteOffReportData | null }) {
  const { t } = useTranslation('features/inventory');
  const { money } = useCurrencyFormat();
  const [data, setData] = useState<WriteOffReportData | null>(initialData);
  const [from, setFrom] = useState(initialData ? dateInputValue(initialData.from) : '');
  const [to, setTo] = useState(initialData ? dateInputValue(initialData.to) : '');
  const [loading, setLoading] = useState(false);
  const currencyCode = data?.currency_code ?? initialData?.currency_code ?? 'USD';

  const run = useCallback(async () => {
    setLoading(true);
    try {
      const result = await writeOffReport({ from: from || null, to: to || null });
      if (isActionMessageError(result) || isActionPermissionError(result)) {
        setData(null);
        toast.error(getErrorMessage(result));
        return;
      }
      setData(result);
    } catch (e: any) {
      toast.error(e?.message || t('writeOffs.runFailed', "Couldn't run the write-off report."));
    } finally {
      setLoading(false);
    }
  }, [from, to, t]);

  const userColumns: ColumnDefinition<WriteOffByUser>[] = [
    { title: t('writeOffs.columns.user', 'User'), dataIndex: 'name', render: (v: any, rec) => v || rec.user_id || t('common.unknown', 'Unknown') },
    { title: t('writeOffs.columns.events', 'Events'), dataIndex: 'events' },
    {
      title: t('writeOffs.columns.writtenOff', 'Written off'),
      dataIndex: 'losses_cents',
      render: (v: any) => <span className="text-red-700 tabular-nums">{money(Number(v), currencyCode)}</span>,
    },
    {
      title: t('writeOffs.columns.foundAdded', 'Found / added'),
      dataIndex: 'gains_cents',
      render: (v: any) => <span className="text-green-700 tabular-nums">{money(Number(v), currencyCode)}</span>,
    },
    {
      title: t('writeOffs.columns.net', 'Net'),
      dataIndex: 'net_cents',
      render: (v: any) => (
        <span className={`tabular-nums ${Number(v) < 0 ? 'text-red-700' : 'text-gray-700'}`}>{money(Number(v), currencyCode)}</span>
      ),
    },
  ];

  const movementLabel = (rec: WriteOffRow): string =>
    rec.count_session_id
      ? t('writeOffs.badges.countCorrection', 'Count correction')
      : rec.movement_type === 'retire'
        ? t('writeOffs.badges.retired', 'Retired')
        : t('writeOffs.badges.adjustment', 'Adjustment');

  const rowColumns: ColumnDefinition<WriteOffRow>[] = [
    {
      title: t('writeOffs.columns.when', 'When'),
      dataIndex: 'created_at',
      render: (v: any) => new Date(v).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }),
    },
    {
      title: t('writeOffs.columns.product', 'Product'),
      dataIndex: 'service_name',
      render: (v: any, rec) => (
        <div>
          <div>{v || t('common.emptyValue', '—')}</div>
          {rec.serial_number && <div className="text-xs text-gray-500 font-mono">{rec.serial_number}</div>}
        </div>
      ),
    },
    { title: t('writeOffs.columns.location', 'Location'), dataIndex: 'location_name', render: (v: any) => v || t('common.emptyValue', '—') },
    {
      title: t('writeOffs.columns.type', 'Type'),
      dataIndex: 'movement_type',
      render: (v: any, rec) => (
        <Badge
          variant={rec.count_session_id ? 'warning' : v === 'retire' ? 'error' : 'secondary'}
          size="sm"
        >
          {movementLabel(rec)}
        </Badge>
      ),
    },
    {
      title: t('writeOffs.columns.qty', 'Qty'),
      dataIndex: 'quantity_delta',
      render: (v: any) => (
        <span className={`tabular-nums ${Number(v) < 0 ? 'text-red-700' : 'text-green-700'}`}>
          {Number(v) > 0 ? `+${v}` : String(v)}
        </span>
      ),
    },
    {
      title: t('writeOffs.columns.value', 'Value'),
      dataIndex: 'value_cents',
      render: (v: any) => (
        <span className={`tabular-nums ${Number(v) < 0 ? 'text-red-700' : 'text-green-700'}`}>{money(Number(v), currencyCode)}</span>
      ),
    },
    { title: t('writeOffs.columns.reason', 'Reason'), dataIndex: 'reason', render: (v: any) => <span className="text-xs">{v || t('common.emptyValue', '—')}</span> },
    { title: t('writeOffs.columns.by', 'By'), dataIndex: 'performed_by_name', render: (v: any, rec) => v || rec.performed_by || t('common.emptyValue', '—') },
  ];

  const printUserColumns: PrintableTableColumn<WriteOffByUser>[] = [
    { key: 'user', header: t('writeOffs.columns.user', 'User'), render: (row) => row.name || row.user_id || t('common.unknown', 'Unknown') },
    { key: 'events', header: t('writeOffs.columns.events', 'Events'), render: (row) => row.events },
    { key: 'writtenOff', header: t('writeOffs.columns.writtenOff', 'Written off'), render: (row) => money(Number(row.losses_cents), currencyCode) },
    { key: 'foundAdded', header: t('writeOffs.columns.foundAdded', 'Found / added'), render: (row) => money(Number(row.gains_cents), currencyCode) },
    { key: 'net', header: t('writeOffs.columns.net', 'Net'), render: (row) => money(Number(row.net_cents), currencyCode) },
  ];

  const printRowColumns: PrintableTableColumn<WriteOffRow>[] = [
    {
      key: 'when',
      header: t('writeOffs.columns.when', 'When'),
      render: (row) => new Date(row.created_at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }),
    },
    {
      key: 'product',
      header: t('writeOffs.columns.product', 'Product'),
      render: (row) => [row.service_name || t('common.emptyValue', '—'), row.serial_number].filter(Boolean).join(' · '),
    },
    { key: 'location', header: t('writeOffs.columns.location', 'Location'), render: (row) => row.location_name || t('common.emptyValue', '—') },
    { key: 'type', header: t('writeOffs.columns.type', 'Type'), render: (row) => movementLabel(row) },
    { key: 'qty', header: t('writeOffs.columns.qty', 'Qty'), render: (row) => (Number(row.quantity_delta) > 0 ? `+${row.quantity_delta}` : String(row.quantity_delta)) },
    { key: 'value', header: t('writeOffs.columns.value', 'Value'), render: (row) => money(Number(row.value_cents), currencyCode) },
    { key: 'reason', header: t('writeOffs.columns.reason', 'Reason'), render: (row) => row.reason || t('common.emptyValue', '—') },
    { key: 'by', header: t('writeOffs.columns.by', 'By'), render: (row) => row.performed_by_name || row.performed_by || t('common.emptyValue', '—') },
  ];

  return (
    <div className="p-6 space-y-4" id="write-offs-page">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold">{t('writeOffs.title', 'Write-offs & adjustments')}</h1>
          <p className="text-sm text-gray-500">
            {t('writeOffs.subtitle', 'Every stock write-down, retirement, and count correction — with the name that signed it. Ledger-backed; nothing here can be edited after the fact.')}
          </p>
        </div>
        <div className="flex items-end gap-2">
          <div>
            <Label className="block mb-1" htmlFor="write-offs-from">{t('common.from', 'From')}</Label>
            <DatePicker id="write-offs-from" label={t('common.from', 'From')} placeholder={t('common.from', 'From')} clearable className="w-40" value={dateFromString(from)} onChange={(date) => setFrom(dateToString(date))} />
          </div>
          <div>
            <Label className="block mb-1" htmlFor="write-offs-to">{t('common.to', 'To')}</Label>
            <DatePicker id="write-offs-to" label={t('common.to', 'To')} placeholder={t('common.to', 'To')} clearable className="w-40" value={dateFromString(to)} onChange={(date) => setTo(dateToString(date))} />
          </div>
          <Button id="write-offs-run" onClick={run} disabled={loading}>
            {loading ? t('common.running', 'Running…') : t('common.run', 'Run')}
          </Button>
          <PrintButton id="write-offs-print" variant="outline" disabled={!data || loading} />
        </div>
      </div>

      {data && (
        <>
          <div className="flex gap-6 text-sm" id="write-offs-totals">
            <div>
              <span className="text-gray-500">{t('writeOffs.totals.writtenOff', 'Written off: ')}</span>
              <span className="font-semibold text-red-700 tabular-nums">{money(data.total_losses_cents, currencyCode)}</span>
            </div>
            <div>
              <span className="text-gray-500">{t('writeOffs.totals.foundAdded', 'Found / added: ')}</span>
              <span className="font-semibold text-green-700 tabular-nums">{money(data.total_gains_cents, currencyCode)}</span>
            </div>
            <div>
              <span className="text-gray-500">{t('writeOffs.totals.net', 'Net: ')}</span>
              <span className={`font-semibold tabular-nums ${data.net_cents < 0 ? 'text-red-700' : 'text-gray-800'}`}>
                {money(data.net_cents, currencyCode)}
              </span>
            </div>
          </div>

          <div>
            <h2 className="text-sm font-semibold text-gray-700 mb-1">{t('writeOffs.byUser', 'By user')}</h2>
            <DataTable id="write-offs-by-user-table" data={data.by_user} columns={userColumns} />
          </div>

          <div>
            <h2 className="text-sm font-semibold text-gray-700 mb-1">{t('writeOffs.eventsTitle', 'Events')}</h2>
            {data.truncated && (
              <p className="text-xs text-amber-700 mb-1">
                {t('writeOffs.truncatedNotice', 'Showing the most recent {{count}} events — the totals above still cover the whole period. Narrow the date range to see everything itemized.', { count: data.rows.length })}
              </p>
            )}
            <DataTable id="write-offs-events-table" data={data.rows} columns={rowColumns} />
          </div>

          <div className="app-print-root app-print-only" id="write-offs-print-region">
            <PrintableDetailHeader
              title={t('writeOffs.title', 'Write-offs & adjustments')}
              subtitle={t('writeOffs.subtitle', 'Every stock write-down, retirement, and count correction — with the name that signed it. Ledger-backed; nothing here can be edited after the fact.')}
              fields={[
                { label: t('common.from', 'From'), value: dateInputValue(data.from) },
                { label: t('common.to', 'To'), value: dateInputValue(data.to) },
              ]}
            />
            <PrintableSummary
              metrics={[
                { label: t('writeOffs.columns.writtenOff', 'Written off'), value: money(data.total_losses_cents, currencyCode) },
                { label: t('writeOffs.columns.foundAdded', 'Found / added'), value: money(data.total_gains_cents, currencyCode) },
                { label: t('writeOffs.columns.net', 'Net'), value: money(data.net_cents, currencyCode) },
              ]}
            />
            <PrintableTable
              title={t('writeOffs.byUser', 'By user')}
              rows={data.by_user}
              columns={printUserColumns}
              getRowKey={(row) => row.user_id ?? row.name ?? 'unknown'}
              emptyMessage={t('common.emptyValue', '—')}
            />
            <PrintableTable
              title={t('writeOffs.eventsTitle', 'Events')}
              subtitle={data.truncated
                ? t('writeOffs.truncatedNotice', 'Showing the most recent {{count}} events — the totals above still cover the whole period. Narrow the date range to see everything itemized.', { count: data.rows.length })
                : undefined}
              rows={data.rows}
              columns={printRowColumns}
              getRowKey={(row) => row.movement_id}
              emptyMessage={t('common.emptyValue', '—')}
            />
          </div>
        </>
      )}
    </div>
  );
}
