'use client';

import React, { useEffect, useState } from 'react';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import { Badge } from '@alga-psa/ui/components/Badge';
import { Switch } from '@alga-psa/ui/components/Switch';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { toast } from 'react-hot-toast';
import type { ColumnDefinition } from '@alga-psa/types';
import {
  getGhostUsageReport,
  setGhostUsageDisposition,
  type GhostUsageFilters,
  type GhostUsageReportResult,
  type GhostUsageCandidateRow,
  type GhostUsageAiStatus,
  type GhostRunResult,
  type GhostDisposition,
} from '../actions';

/**
 * Ghost-usage report (PRD §16/§17): the tickets a hardware shop closed with no part
 * recorded — the cost it may have eaten silently. A deterministic CE funnel (closed →
 * in scope → has materials → ghost candidates) plus an opt-in EE/AI triage lane whose
 * server actions arrive as props (D12) so this package never imports @ee. The AI lane
 * is strictly additive: if its status fetch fails or the gates are off, the CE report
 * stands on its own.
 */

const DEFAULT_WINDOW_DAYS = 90;
const CLASSIFY_BATCH = 25;

const isoDaysAgo = (days: number): string => {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
};

const shortDate = (iso: string | null): string =>
  iso ? new Date(iso).toLocaleDateString(undefined, { dateStyle: 'medium' }) : '—';

// available/enabled all false: what we assume when the AI status probe fails, so a
// flaky EE endpoint hides the AI lane rather than breaking the whole page (§17.1).
const AI_UNAVAILABLE: GhostUsageAiStatus = {
  edition_ok: false,
  addon_ok: false,
  enabled: false,
  available: false,
  can_run: false,
};

export function GhostUsageReport({
  getAiStatus,
  setAiEnabled,
  runAiClassification,
}: {
  getAiStatus: () => Promise<GhostUsageAiStatus>;
  setAiEnabled: (enabled: boolean) => Promise<GhostUsageAiStatus>;
  runAiClassification: (filters?: GhostUsageFilters, opts?: { limit?: number }) => Promise<GhostRunResult>;
}) {
  const [report, setReport] = useState<GhostUsageReportResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [aiStatus, setAiStatus] = useState<GhostUsageAiStatus | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [boardId, setBoardId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [from, setFrom] = useState<string>(() => isoDaysAgo(DEFAULT_WINDOW_DAYS));
  const [to, setTo] = useState('');
  const [busyRows, setBusyRows] = useState<Set<string>>(() => new Set());

  const currentFilters = (): GhostUsageFilters => ({
    boardIds: boardId ? [boardId] : [],
    categoryIds: categoryId ? [categoryId] : [],
    closedFrom: from || null,
    closedTo: to || null,
  });

  const runReport = async (filters: GhostUsageFilters) => {
    setLoading(true);
    try {
      setReport(await getGhostUsageReport(filters));
    } catch (e: any) {
      toast.error(e?.message || "Couldn't run the ghost-usage report.");
    } finally {
      setLoading(false);
    }
  };

  const loadAiStatus = async () => {
    try {
      setAiStatus(await getAiStatus());
    } catch {
      setAiStatus(AI_UNAVAILABLE); // AI probe failing must never break the CE report
    }
  };

  useEffect(() => {
    void runReport(currentFilters());
    void loadAiStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const run = () => void runReport(currentFilters());
  const refresh = () => {
    void runReport(currentFilters());
    void loadAiStatus();
  };

  const handleToggle = async (next: boolean) => {
    setAiBusy(true);
    try {
      const status = await setAiEnabled(next);
      setAiStatus(status);
      toast.success(status.enabled ? 'AI triage on.' : 'AI triage off.');
    } catch (e: any) {
      toast.error(e?.message || "Couldn't change the AI triage setting.");
    } finally {
      setAiBusy(false);
    }
  };

  const runClassification = async () => {
    setAiBusy(true);
    try {
      const r = await runAiClassification(currentFilters(), { limit: CLASSIFY_BATCH });
      if (!r.attempted) {
        toast.error(`AI triage didn't run${r.reason ? ` (${r.reason})` : ''}.`);
      } else {
        toast.success(
          `Classified ${r.classified} (unclear ${r.unclear}, failed ${r.failed}, remaining ${r.remaining_unclassified})`,
        );
        await runReport(currentFilters());
      }
    } catch (e: any) {
      toast.error(e?.message || 'AI triage failed.');
    } finally {
      setAiBusy(false);
    }
  };

  const disposition = async (reviewId: string, next: GhostDisposition) => {
    setBusyRows((prev) => new Set(prev).add(reviewId));
    try {
      await setGhostUsageDisposition({ review_id: reviewId, disposition: next });
      toast.success(
        next === 'confirmed'
          ? 'Confirmed — moved to the worklist.'
          : next === 'dismissed'
            ? 'Dismissed.'
            : 'Reopened.',
      );
      await runReport(currentFilters());
    } catch (e: any) {
      toast.error(e?.message || "Couldn't update this ticket.");
    } finally {
      setBusyRows((prev) => {
        const nextSet = new Set(prev);
        nextSet.delete(reviewId);
        return nextSet;
      });
    }
  };

  const boardOptions = [
    { value: '', label: 'All boards' },
    ...(report?.boards ?? []).map((b) => ({ value: b.board_id, label: b.board_name })),
  ];
  const categoryOptions = [
    { value: '', label: 'All categories' },
    ...(report?.categories ?? []).map((c) => ({
      value: c.category_id,
      label: `${c.parent_category ? '— ' : ''}${c.category_name}`,
    })),
  ];

  const verdictCell = (rec: GhostUsageCandidateRow) => {
    if (!rec.ai_classification) return <span className="text-gray-400">—</span>;
    const pct = rec.ai_confidence != null ? ` ${Math.round(rec.ai_confidence * 100)}%` : '';
    const badge =
      rec.ai_classification === 'hardware_missing' ? (
        <Badge variant="warning" size="sm">Hardware missing{pct}</Badge>
      ) : rec.ai_classification === 'no_hardware' ? (
        <Badge variant="secondary" size="sm">No hardware{pct}</Badge>
      ) : (
        <Badge variant="secondary" size="sm">Unclear{pct}</Badge>
      );
    return (
      <div className="space-y-0.5">
        {badge}
        {rec.ai_reason && (
          <div className="text-xs text-gray-500 max-w-[16rem] truncate" title={rec.ai_reason}>
            {rec.ai_reason}
          </div>
        )}
      </div>
    );
  };

  const candidateActions = (rec: GhostUsageCandidateRow) => {
    const rid = rec.review_id;
    if (rid && rec.disposition === 'pending') {
      const busy = busyRows.has(rid);
      return (
        <div className="flex gap-1">
          <Button
            id={`ghost-usage-confirm-${rid}`}
            variant="default"
            size="sm"
            disabled={busy}
            onClick={() => disposition(rid, 'confirmed')}
          >
            Confirm
          </Button>
          <Button
            id={`ghost-usage-dismiss-${rid}`}
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() => disposition(rid, 'dismissed')}
          >
            Dismiss
          </Button>
        </div>
      );
    }
    return (
      <a
        id={`ghost-usage-open-${rec.ticket_id}`}
        href={`/msp/tickets/${rec.ticket_id}`}
        target="_blank"
        rel="noreferrer"
        className="text-sm text-primary-600 underline"
      >
        Open ticket
      </a>
    );
  };

  const worklistActions = (rec: GhostUsageCandidateRow) => {
    const rid = rec.review_id;
    const busy = rid ? busyRows.has(rid) : false;
    return (
      <div className="flex items-center gap-2">
        <a
          id={`ghost-usage-worklist-open-${rec.ticket_id}`}
          href={`/msp/tickets/${rec.ticket_id}`}
          target="_blank"
          rel="noreferrer"
          className="text-sm text-primary-600 underline"
        >
          Open ticket · add material
        </a>
        {rid && (
          <Button
            id={`ghost-usage-reopen-${rid}`}
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() => disposition(rid, 'pending')}
          >
            Reopen
          </Button>
        )}
      </div>
    );
  };

  const baseColumns: ColumnDefinition<GhostUsageCandidateRow>[] = [
    {
      title: 'Ticket #',
      dataIndex: 'ticket_number',
      render: (_v: any, rec) => (
        <a
          id={`ghost-usage-ticket-${rec.ticket_id}`}
          href={`/msp/tickets/${rec.ticket_id}`}
          target="_blank"
          rel="noreferrer"
          className="text-primary-600 underline tabular-nums"
        >
          {rec.ticket_number}
        </a>
      ),
    },
    {
      title: 'Title',
      dataIndex: 'title',
      render: (v: any) => (
        <span className="block max-w-[20rem] truncate" title={v || ''}>
          {v || '—'}
        </span>
      ),
    },
    { title: 'Board', dataIndex: 'board_name', render: (v: any) => v || '—' },
    { title: 'Category', dataIndex: 'category_name', render: (v: any) => v || '—' },
    { title: 'Client', dataIndex: 'client_name', render: (v: any) => v || '—' },
    { title: 'Closed', dataIndex: 'closed_at', render: (v: any) => shortDate(v) },
    { title: 'Closed by', dataIndex: 'closed_by_name', render: (v: any) => v || '—' },
    { title: 'Assigned to', dataIndex: 'assigned_to_name', render: (v: any) => v || '—' },
  ];

  const candidateColumns: ColumnDefinition<GhostUsageCandidateRow>[] = [
    ...baseColumns,
    { title: 'AI verdict', dataIndex: 'ai_classification', render: (_v: any, rec) => verdictCell(rec) },
    { title: 'Actions', dataIndex: 'review_id', render: (_v: any, rec) => candidateActions(rec) },
  ];

  const worklistColumns: ColumnDefinition<GhostUsageCandidateRow>[] = [
    ...baseColumns,
    { title: 'Actions', dataIndex: 'ticket_id', render: (_v: any, rec) => worklistActions(rec) },
  ];

  const funnel = report?.funnel;
  const funnelDenom = Math.max(funnel?.closed_in_scope ?? 0, 1);
  const funnelStages = funnel
    ? [
        { label: 'Closed in window', value: funnel.closed_in_scope, amber: false },
        { label: 'In hardware scope', value: funnel.hardware_scoped, amber: false },
        { label: 'Has materials', value: funnel.with_consumption, amber: false },
        { label: 'Ghost candidates', value: funnel.candidates, amber: true },
      ]
    : [];

  return (
    <div className="p-6 space-y-5" id="ghost-usage-page">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold">Ghost Usage</h1>
          <p className="text-sm text-gray-500">
            Closed hardware tickets with no recorded parts — work the shop may have eaten.
          </p>
        </div>
        <Button id="ghost-usage-refresh" variant="outline" onClick={refresh} disabled={loading}>
          {loading ? 'Refreshing…' : 'Refresh'}
        </Button>
      </div>

      <div className="flex items-end gap-3 flex-wrap">
        <div className="w-52">
          <label className="block text-sm font-medium mb-1">Board</label>
          <CustomSelect
            id="ghost-usage-board"
            options={boardOptions}
            value={boardId}
            onValueChange={(v) => setBoardId(v)}
          />
        </div>
        <div className="w-56">
          <label className="block text-sm font-medium mb-1">Category</label>
          <CustomSelect
            id="ghost-usage-category"
            options={categoryOptions}
            value={categoryId}
            onValueChange={(v) => setCategoryId(v)}
          />
        </div>
        <Input id="ghost-usage-from" label="From" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        <Input id="ghost-usage-to" label="To" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        <Button id="ghost-usage-run" onClick={run} disabled={loading}>
          {loading ? 'Running…' : 'Run report'}
        </Button>
      </div>

      {loading && !report && <p className="text-sm text-gray-500">Loading ghost candidates…</p>}
      {!loading && !report && (
        <p className="text-sm text-red-700">Couldn&apos;t load the ghost-usage report. Try Refresh.</p>
      )}

      {report && funnel && (
        <>
          <div className="space-y-2" id="ghost-usage-funnel">
            {funnelStages.map((s) => (
              <div key={s.label} className="flex items-center gap-3">
                <div className="w-36 shrink-0 text-sm text-gray-600">{s.label}</div>
                <div className="flex-1 h-5 rounded overflow-hidden bg-gray-100">
                  <div
                    className={`h-full ${s.amber ? 'bg-amber-400' : 'bg-[rgb(var(--color-primary-400))]'}`}
                    style={{ width: `${(s.value / funnelDenom) * 100}%` }}
                  />
                </div>
                <div
                  className={`w-12 text-right text-sm tabular-nums ${
                    s.amber ? 'font-semibold text-amber-700' : 'text-gray-700'
                  }`}
                >
                  {s.value}
                </div>
              </div>
            ))}
          </div>

          <div className="rounded border p-4 space-y-2" id="ghost-usage-ai-card">
            {aiStatus === null ? (
              <p className="text-sm text-gray-400">Checking AI availability…</p>
            ) : !aiStatus.available ? (
              <p className="text-sm text-gray-500">AI triage requires Enterprise and the AI Assistant add-on.</p>
            ) : (
              <>
                <Switch
                  id="ghost-usage-ai-toggle"
                  checked={aiStatus.enabled}
                  disabled={aiBusy}
                  onCheckedChange={handleToggle}
                  label="AI triage — classify candidate tickets with the AI add-on"
                />
                <div className="flex items-center gap-3">
                  <Button
                    id="ghost-usage-ai-run"
                    variant="soft"
                    size="sm"
                    disabled={!aiStatus.can_run || aiBusy}
                    onClick={runClassification}
                  >
                    {aiBusy ? 'Classifying…' : 'Classify candidates'}
                  </Button>
                  <span className="text-xs text-gray-500">Runs on up to {CLASSIFY_BATCH} candidates per pass.</span>
                </div>
              </>
            )}
          </div>

          <div className="space-y-1">
            <div className="text-sm text-gray-600" id="ghost-usage-candidate-count">
              {funnel.candidates} ghost candidate{funnel.candidates === 1 ? '' : 's'}
              {report.candidates.length >= report.candidate_cap ? ` (showing first ${report.candidate_cap})` : ''}
            </div>
            {report.candidates.length === 0 ? (
              <p className="text-sm text-gray-500">No ghost candidates — nothing looks eaten.</p>
            ) : (
              <DataTable id="ghost-usage-candidates-table" data={report.candidates} columns={candidateColumns} />
            )}
          </div>

          {report.worklist.length > 0 && (
            <div className="space-y-1">
              <h2 className="text-sm font-semibold text-gray-700">Confirmed — record the material</h2>
              <DataTable id="ghost-usage-worklist-table" data={report.worklist} columns={worklistColumns} />
            </div>
          )}
        </>
      )}
    </div>
  );
}
