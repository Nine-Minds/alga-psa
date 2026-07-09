'use client';

import React, { useState, useCallback } from 'react';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import { Badge } from '@alga-psa/ui/components/Badge';
import { toast } from 'react-hot-toast';
import type { ColumnDefinition } from '@alga-psa/types';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { getErrorMessage, isActionMessageError, isActionPermissionError } from '@alga-psa/ui/lib/errorHandling';
import { writeOffReport, type WriteOffReportData, type WriteOffRow, type WriteOffByUser } from '../actions';

/**
 * Owner's write-off review (Sam review P2): every adjustment, retirement, and count
 * correction in a period with who signed it and the dollars — the audit trail for the
 * person who HOLDS the approve button. Signs follow stock: negative = written down.
 */

const money = (cents: number): string => {
  const v = cents / 100;
  const s = `$${Math.abs(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return v < 0 ? `-${s}` : s;
};

const dateInputValue = (iso: string): string => iso.slice(0, 10);

export function WriteOffsReport({ initialData }: { initialData: WriteOffReportData | null }) {
  const { t } = useTranslation('features/inventory');
  const [data, setData] = useState<WriteOffReportData | null>(initialData);
  const [from, setFrom] = useState(initialData ? dateInputValue(initialData.from) : '');
  const [to, setTo] = useState(initialData ? dateInputValue(initialData.to) : '');
  const [loading, setLoading] = useState(false);

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
      render: (v: any) => <span className="text-red-700 tabular-nums">{money(Number(v))}</span>,
    },
    {
      title: t('writeOffs.columns.foundAdded', 'Found / added'),
      dataIndex: 'gains_cents',
      render: (v: any) => <span className="text-green-700 tabular-nums">{money(Number(v))}</span>,
    },
    {
      title: t('writeOffs.columns.net', 'Net'),
      dataIndex: 'net_cents',
      render: (v: any) => (
        <span className={`tabular-nums ${Number(v) < 0 ? 'text-red-700' : 'text-gray-700'}`}>{money(Number(v))}</span>
      ),
    },
  ];

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
      render: (v: any, rec) =>
        rec.count_session_id ? (
          <Badge variant="warning" size="sm">{t('writeOffs.badges.countCorrection', 'Count correction')}</Badge>
        ) : v === 'retire' ? (
          <Badge variant="error" size="sm">{t('writeOffs.badges.retired', 'Retired')}</Badge>
        ) : (
          <Badge variant="secondary" size="sm">{t('writeOffs.badges.adjustment', 'Adjustment')}</Badge>
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
        <span className={`tabular-nums ${Number(v) < 0 ? 'text-red-700' : 'text-green-700'}`}>{money(Number(v))}</span>
      ),
    },
    { title: t('writeOffs.columns.reason', 'Reason'), dataIndex: 'reason', render: (v: any) => <span className="text-xs">{v || t('common.emptyValue', '—')}</span> },
    { title: t('writeOffs.columns.by', 'By'), dataIndex: 'performed_by_name', render: (v: any, rec) => v || rec.performed_by || t('common.emptyValue', '—') },
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
          <Input id="write-offs-from" label={t('common.from', 'From')} type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          <Input id="write-offs-to" label={t('common.to', 'To')} type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          <Button id="write-offs-run" onClick={run} disabled={loading}>
            {loading ? t('common.running', 'Running…') : t('common.run', 'Run')}
          </Button>
        </div>
      </div>

      {data && (
        <>
          <div className="flex gap-6 text-sm" id="write-offs-totals">
            <div>
              <span className="text-gray-500">{t('writeOffs.totals.writtenOff', 'Written off: ')}</span>
              <span className="font-semibold text-red-700 tabular-nums">{money(data.total_losses_cents)}</span>
            </div>
            <div>
              <span className="text-gray-500">{t('writeOffs.totals.foundAdded', 'Found / added: ')}</span>
              <span className="font-semibold text-green-700 tabular-nums">{money(data.total_gains_cents)}</span>
            </div>
            <div>
              <span className="text-gray-500">{t('writeOffs.totals.net', 'Net: ')}</span>
              <span className={`font-semibold tabular-nums ${data.net_cents < 0 ? 'text-red-700' : 'text-gray-800'}`}>
                {money(data.net_cents)}
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
        </>
      )}
    </div>
  );
}
