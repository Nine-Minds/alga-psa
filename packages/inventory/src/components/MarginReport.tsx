'use client';

import React, { useEffect, useState } from 'react';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import { toast } from 'react-hot-toast';
import type { ColumnDefinition } from '@alga-psa/types';
import { marginReport, type MarginReport as MarginReportData, type MarginReportRow } from '../actions';

/**
 * Margin report (F042/F043): per-service revenue, COGS, and margin from sales-driven
 * consume movements, over an optional date window. Read-only; internal (owner) view.
 */

const money = (cents: number | null | undefined): string =>
  `$${(Number(cents ?? 0) / 100).toFixed(2)}`;

const pct = (value: number | null | undefined): string =>
  value == null ? '—' : `${value.toFixed(1)}%`;

export function MarginReport() {
  const [report, setReport] = useState<MarginReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const run = async () => {
    setLoading(true);
    try {
      setReport(await marginReport({ from: from || undefined, to: to || undefined }));
    } catch (e: any) {
      toast.error(e?.message || "Couldn't run the margin report.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const rows: MarginReportRow[] = report?.rows ?? [];

  const columns: ColumnDefinition<MarginReportRow>[] = [
    {
      title: 'Product',
      dataIndex: 'service_name',
      render: (v: any, rec) => (
        <div className="flex items-center gap-2">
          <span>{v || '—'}</span>
          {rec.sku ? <span className="font-mono text-xs text-gray-500">{rec.sku}</span> : null}
        </div>
      ),
    },
    { title: 'Qty sold', dataIndex: 'qty_sold', render: (v: any) => <span className="tabular-nums">{Number(v ?? 0)}</span> },
    { title: 'Revenue', dataIndex: 'revenue_cents', render: (v: any) => <span className="tabular-nums">{money(v)}</span> },
    { title: 'COGS', dataIndex: 'cogs_cents', render: (v: any) => <span className="tabular-nums">{money(v)}</span> },
    { title: 'Margin', dataIndex: 'margin_cents', render: (v: any) => <span className="tabular-nums">{money(v)}</span> },
    { title: 'Margin %', dataIndex: 'margin_pct', render: (v: any) => <span className="tabular-nums">{pct(v)}</span> },
  ];

  return (
    <div className="p-6 space-y-5" id="margin-report-page">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold">Margin Report</h1>
          <p className="text-sm text-gray-500">
            Revenue, cost of goods sold, and margin per product from fulfilled sales orders.
          </p>
        </div>
        <Button id="margin-report-refresh" variant="outline" onClick={run} disabled={loading}>
          {loading ? 'Refreshing…' : 'Refresh'}
        </Button>
      </div>

      <div className="flex items-end gap-3 flex-wrap">
        <Input id="margin-report-from" label="From" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        <Input id="margin-report-to" label="To" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        <Button id="margin-report-run" onClick={run} disabled={loading}>
          {loading ? 'Running…' : 'Run report'}
        </Button>
      </div>

      {report && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4" id="margin-report-totals">
          <div className="rounded border p-3">
            <div className="text-xs text-gray-500">Revenue</div>
            <div className="text-xl font-semibold tabular-nums">{money(report.total_revenue_cents)}</div>
          </div>
          <div className="rounded border p-3">
            <div className="text-xs text-gray-500">COGS</div>
            <div className="text-xl font-semibold tabular-nums">{money(report.total_cogs_cents)}</div>
          </div>
          <div className="rounded border p-3">
            <div className="text-xs text-gray-500">Margin</div>
            <div className="text-xl font-semibold tabular-nums">{money(report.total_margin_cents)}</div>
          </div>
          <div className="rounded border p-3">
            <div className="text-xs text-gray-500">Margin %</div>
            <div className="text-xl font-semibold tabular-nums">{pct(report.total_margin_pct)}</div>
          </div>
        </div>
      )}

      {loading && !report ? (
        <p className="text-sm text-gray-500">Loading margin…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-gray-500">No sales-driven margin in this window.</p>
      ) : (
        <DataTable id="margin-report-table" data={rows} columns={columns} />
      )}
    </div>
  );
}
