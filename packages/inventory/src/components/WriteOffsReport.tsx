'use client';

import React, { useState, useCallback } from 'react';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import { Badge } from '@alga-psa/ui/components/Badge';
import { toast } from 'react-hot-toast';
import type { ColumnDefinition } from '@alga-psa/types';
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
  const [data, setData] = useState<WriteOffReportData | null>(initialData);
  const [from, setFrom] = useState(initialData ? dateInputValue(initialData.from) : '');
  const [to, setTo] = useState(initialData ? dateInputValue(initialData.to) : '');
  const [loading, setLoading] = useState(false);

  const run = useCallback(async () => {
    setLoading(true);
    try {
      setData(await writeOffReport({ from: from || null, to: to || null }));
    } catch (e: any) {
      toast.error(e?.message || "Couldn't run the write-off report.");
    } finally {
      setLoading(false);
    }
  }, [from, to]);

  const userColumns: ColumnDefinition<WriteOffByUser>[] = [
    { title: 'User', dataIndex: 'name', render: (v: any, rec) => v || rec.user_id || 'Unknown' },
    { title: 'Events', dataIndex: 'events' },
    {
      title: 'Written off',
      dataIndex: 'losses_cents',
      render: (v: any) => <span className="text-red-700 tabular-nums">{money(Number(v))}</span>,
    },
    {
      title: 'Found / added',
      dataIndex: 'gains_cents',
      render: (v: any) => <span className="text-green-700 tabular-nums">{money(Number(v))}</span>,
    },
    {
      title: 'Net',
      dataIndex: 'net_cents',
      render: (v: any) => (
        <span className={`tabular-nums ${Number(v) < 0 ? 'text-red-700' : 'text-gray-700'}`}>{money(Number(v))}</span>
      ),
    },
  ];

  const rowColumns: ColumnDefinition<WriteOffRow>[] = [
    {
      title: 'When',
      dataIndex: 'created_at',
      render: (v: any) => new Date(v).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }),
    },
    {
      title: 'Product',
      dataIndex: 'service_name',
      render: (v: any, rec) => (
        <div>
          <div>{v || '—'}</div>
          {rec.serial_number && <div className="text-xs text-gray-500 font-mono">{rec.serial_number}</div>}
        </div>
      ),
    },
    { title: 'Location', dataIndex: 'location_name', render: (v: any) => v || '—' },
    {
      title: 'Type',
      dataIndex: 'movement_type',
      render: (v: any, rec) =>
        rec.count_session_id ? (
          <Badge variant="warning" size="sm">Count correction</Badge>
        ) : v === 'retire' ? (
          <Badge variant="error" size="sm">Retired</Badge>
        ) : (
          <Badge variant="secondary" size="sm">Adjustment</Badge>
        ),
    },
    {
      title: 'Qty',
      dataIndex: 'quantity_delta',
      render: (v: any) => (
        <span className={`tabular-nums ${Number(v) < 0 ? 'text-red-700' : 'text-green-700'}`}>
          {Number(v) > 0 ? `+${v}` : String(v)}
        </span>
      ),
    },
    {
      title: 'Value',
      dataIndex: 'value_cents',
      render: (v: any) => (
        <span className={`tabular-nums ${Number(v) < 0 ? 'text-red-700' : 'text-green-700'}`}>{money(Number(v))}</span>
      ),
    },
    { title: 'Reason', dataIndex: 'reason', render: (v: any) => <span className="text-xs">{v || '—'}</span> },
    { title: 'By', dataIndex: 'performed_by_name', render: (v: any, rec) => v || rec.performed_by || '—' },
  ];

  return (
    <div className="p-6 space-y-4" id="write-offs-page">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold">Write-offs &amp; adjustments</h1>
          <p className="text-sm text-gray-500">
            Every stock write-down, retirement, and count correction — with the name that signed it. Ledger-backed;
            nothing here can be edited after the fact.
          </p>
        </div>
        <div className="flex items-end gap-2">
          <Input id="write-offs-from" label="From" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          <Input id="write-offs-to" label="To" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          <Button id="write-offs-run" onClick={run} disabled={loading}>
            {loading ? 'Running…' : 'Run'}
          </Button>
        </div>
      </div>

      {data && (
        <>
          <div className="flex gap-6 text-sm" id="write-offs-totals">
            <div>
              <span className="text-gray-500">Written off: </span>
              <span className="font-semibold text-red-700 tabular-nums">{money(data.total_losses_cents)}</span>
            </div>
            <div>
              <span className="text-gray-500">Found / added: </span>
              <span className="font-semibold text-green-700 tabular-nums">{money(data.total_gains_cents)}</span>
            </div>
            <div>
              <span className="text-gray-500">Net: </span>
              <span className={`font-semibold tabular-nums ${data.net_cents < 0 ? 'text-red-700' : 'text-gray-800'}`}>
                {money(data.net_cents)}
              </span>
            </div>
          </div>

          <div>
            <h2 className="text-sm font-semibold text-gray-700 mb-1">By user</h2>
            <DataTable id="write-offs-by-user-table" data={data.by_user} columns={userColumns} />
          </div>

          <div>
            <h2 className="text-sm font-semibold text-gray-700 mb-1">Events</h2>
            {data.truncated && (
              <p className="text-xs text-amber-700 mb-1">
                Showing the most recent {data.rows.length} events — the totals above still cover the whole period.
                Narrow the date range to see everything itemized.
              </p>
            )}
            <DataTable id="write-offs-events-table" data={data.rows} columns={rowColumns} />
          </div>
        </>
      )}
    </div>
  );
}
