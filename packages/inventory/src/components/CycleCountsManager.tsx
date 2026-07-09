'use client';

import React, { useState, useCallback } from 'react';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import { TextArea } from '@alga-psa/ui/components/TextArea';
import { Badge, type BadgeVariant } from '@alga-psa/ui/components/Badge';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { Dialog } from '@alga-psa/ui/components/Dialog';
import { useCurrencyFormat } from '@alga-psa/ui/lib';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { toast } from 'react-hot-toast';
import type { ColumnDefinition, ICountSession, IStockLocation } from '@alga-psa/types';
import {
  listCountSessions,
  startCountSession,
  getCountSession,
  recordCount,
  submitCountForReview,
  approveCountSession,
  cancelCountSession,
  type CountSessionView,
  type CountLineView,
  type UnexpectedSerialDisposition,
} from '../actions';

type SessionRow = ICountSession & { location_name: string | null; line_count: number; counted_count: number };

export function CycleCountsManager({
  initialSessions,
  locations,
  defaultCurrencyCode = 'USD',
}: {
  initialSessions: SessionRow[];
  locations: IStockLocation[];
  defaultCurrencyCode?: string;
}) {
  const { t } = useTranslation('features/inventory');
  const { money } = useCurrencyFormat();
  const [sessions, setSessions] = useState<SessionRow[]>(initialSessions || []);
  const [startOpen, setStartOpen] = useState(false);
  const [startLocation, setStartLocation] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const [detail, setDetail] = useState<CountSessionView | null>(null);
  // Per-line draft entries (qty text or serial textarea), keyed by service_id.
  const [entries, setEntries] = useState<Record<string, string>>({});
  // Approver dispositions for unexpected serials, keyed by serial.
  const [dispositions, setDispositions] = useState<Record<string, 'add' | 'exclude'>>({});

  const STATUS_BADGES: Record<string, { label: string; variant: BadgeVariant }> = {
    draft: { label: t('counts.status.draft', 'Draft'), variant: 'secondary' },
    in_progress: { label: t('counts.status.counting', 'Counting'), variant: 'warning' },
    review: { label: t('counts.status.inReview', 'In review'), variant: 'info' },
    approved: { label: t('counts.status.approved', 'Approved'), variant: 'success' },
    cancelled: { label: t('counts.status.cancelled', 'Cancelled'), variant: 'error' },
  };

  const reload = useCallback(async () => {
    try {
      setSessions(await listCountSessions());
    } catch (e: any) {
      toast.error(e?.message || t('counts.loadSessionsFailed', "Couldn't load count sessions."));
    }
  }, [t]);

  const openDetail = async (sessionId: string) => {
    try {
      const view = await getCountSession(sessionId);
      setDetail(view);
      const draft: Record<string, string> = {};
      for (const l of view.lines) {
        draft[l.service_id] = l.is_serialized
          ? (l.counted_serials ?? []).join('\n')
          : l.counted_qty != null
            ? String(l.counted_qty)
            : '';
      }
      setEntries(draft);
      // Prune dispositions to serials that are still unexpected — never wipe them:
      // submit-for-review reloads the session, and the approver's picks must survive it.
      const stillUnexpected = new Set<string>();
      if (view.can_review) {
        for (const l of view.lines) {
          if (!l.is_serialized) continue;
          const expected = new Set(l.expected_serials_visible ?? []);
          for (const s of l.counted_serials ?? []) if (!expected.has(s)) stillUnexpected.add(s);
        }
      }
      setDispositions((prev) =>
        Object.fromEntries(Object.entries(prev).filter(([serial]) => stillUnexpected.has(serial))),
      );
    } catch (e: any) {
      toast.error(e?.message || t('counts.loadSessionFailed', "Couldn't load the session."));
    }
  };

  const start = async () => {
    if (!startLocation) {
      toast.error(t('counts.pickLocation', 'Pick a location to count.'));
      return;
    }
    setBusy('start');
    try {
      const session = await startCountSession(startLocation);
      toast.success(t('counts.started', 'Count started — expected quantities were snapshotted.'));
      setStartOpen(false);
      setStartLocation('');
      await reload();
      await openDetail(session.session_id);
    } catch (e: any) {
      toast.error(e?.message || t('counts.startFailed', "Couldn't start the count."));
    } finally {
      setBusy(null);
    }
  };

  const saveLine = async (line: CountLineView) => {
    if (!detail) return;
    const raw = entries[line.service_id] ?? '';
    setBusy(`line:${line.service_id}`);
    try {
      if (line.is_serialized) {
        const serials = raw.split('\n').map((s) => s.trim()).filter(Boolean);
        await recordCount(detail.session_id, line.service_id, { serials });
      } else {
        const qty = Number(raw);
        if (!Number.isInteger(qty) || qty < 0) {
          toast.error(t('counts.qtyInvalid', 'Count must be a non-negative whole number.'));
          return;
        }
        await recordCount(detail.session_id, line.service_id, { counted_qty: qty });
      }
      toast.success(t('counts.recorded', 'Count recorded.'));
      await openDetail(detail.session_id);
    } catch (e: any) {
      toast.error(e?.message || t('counts.recordFailed', "Couldn't record the count."));
    } finally {
      setBusy(null);
    }
  };

  const submit = async () => {
    if (!detail) return;
    setBusy('submit');
    try {
      await submitCountForReview(detail.session_id);
      toast.success(t('counts.submitted', 'Submitted for review.'));
      await reload();
      await openDetail(detail.session_id);
    } catch (e: any) {
      toast.error(e?.message || t('counts.submitFailed', "Couldn't submit the session."));
    } finally {
      setBusy(null);
    }
  };

  const approve = async () => {
    if (!detail) return;
    const dispositionList: UnexpectedSerialDisposition[] = Object.entries(dispositions).map(
      ([serial_number, action]) => ({ serial_number, action }),
    );
    setBusy('approve');
    try {
      const result = await approveCountSession(detail.session_id, dispositionList);
      const parts = [
        t('counts.adjustments', '{{count}} adjustment(s)', { count: result.adjustments.length }),
        result.retired_serials.length ? t('counts.unitsRetired', '{{count}} unit(s) retired', { count: result.retired_serials.length }) : null,
        result.added_serials.length ? t('counts.unitsAdded', '{{count}} unit(s) added', { count: result.added_serials.length }) : null,
      ].filter(Boolean);
      toast.success(t('counts.approved', 'Count approved — {{summary}}.', { summary: parts.join(', ') }));
      if (result.stale_service_ids.length > 0) {
        toast(t('counts.staleLines', '{{count}} line(s) were stale (stock moved mid-count) and were skipped — recount them.', { count: result.stale_service_ids.length }), { icon: '⚠️' });
      }
      if (result.uncounted_service_ids.length > 0) {
        toast(t('counts.uncountedLines', '{{count}} line(s) were never counted and were left untouched.', { count: result.uncounted_service_ids.length }), { icon: 'ℹ️' });
      }
      await reload();
      await openDetail(detail.session_id);
    } catch (e: any) {
      toast.error(e?.message || t('counts.approveFailed', "Couldn't approve the session."));
    } finally {
      setBusy(null);
    }
  };

  const cancel = async () => {
    if (!detail) return;
    setBusy('cancel');
    try {
      await cancelCountSession(detail.session_id);
      toast.success(t('counts.cancelledDone', 'Count cancelled — no stock was touched.'));
      setDetail(null);
      await reload();
    } catch (e: any) {
      toast.error(e?.message || t('counts.cancelFailed', "Couldn't cancel the session."));
    } finally {
      setBusy(null);
    }
  };

  /** Unexpected serials for a serialized line (approver view only). */
  const unexpectedSerials = (line: CountLineView): string[] => {
    if (!detail?.can_review || !line.is_serialized) return [];
    const expected = new Set(line.expected_serials_visible ?? []);
    return (line.counted_serials ?? []).filter((s) => !expected.has(s));
  };

  const columns: ColumnDefinition<SessionRow>[] = [
    { title: t('counts.fields.location', 'Location'), dataIndex: 'location_name', render: (v: any, rec) => v || rec.location_id },
    {
      title: t('common.status', 'Status'),
      dataIndex: 'status',
      render: (v: any) => {
        const meta = STATUS_BADGES[v] ?? { label: String(v), variant: 'secondary' as BadgeVariant };
        return (
          <Badge variant={meta.variant} size="sm">
            {meta.label}
          </Badge>
        );
      },
    },
    {
      title: t('counts.columns.progress', 'Progress'),
      dataIndex: 'line_count',
      render: (_: any, rec) => t('counts.progressValue', '{{counted}} of {{total}} counted', { counted: rec.counted_count, total: rec.line_count }),
    },
    {
      title: t('counts.columns.started', 'Started'),
      dataIndex: 'started_at',
      render: (v: any) => (v ? new Date(v).toLocaleDateString() : t('common.emptyValue', '—')),
    },
    {
      title: t('common.actions', 'Actions'),
      dataIndex: 'session_id',
      width: '120px',
      render: (_: any, rec) => (
        <Button id={`open-count-${rec.session_id}`} variant="outline" size="sm" onClick={() => openDetail(rec.session_id)}>
          {t('counts.open', 'Open')}
        </Button>
      ),
    },
  ];

  const editable = detail?.status === 'in_progress';

  return (
    <div className="p-6 space-y-4" id="cycle-counts-page">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{t('counts.title', 'Cycle Counts')}</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {t('counts.subtitle', 'Blind per-location stock takes — variances apply through the movement ledger on approval.')}
          </p>
        </div>
        <Button id="cycle-counts-start-button" onClick={() => setStartOpen(true)}>
          {t('counts.startCount', 'Start count')}
        </Button>
      </div>

      <DataTable id="cycle-counts-table" data={sessions} columns={columns} />

      {/* ---- Start dialog ---- */}
      <Dialog isOpen={startOpen} onClose={() => setStartOpen(false)} title={t('counts.startDialogTitle', 'Start a cycle count')} id="start-count-dialog">
        <div className="space-y-4 p-1">
          <CustomSelect
            id="start-count-location"
            label={t('counts.fields.location', 'Location')}
            placeholder={t('counts.fields.locationPlaceholder', 'Select a location…')}
            value={startLocation}
            onValueChange={setStartLocation}
            options={locations.map((l) => ({ value: l.location_id, label: l.name }))}
          />
          <p className="text-xs text-gray-500">
            {t('counts.blindCountHint', 'Expected quantities are snapshotted now and hidden during counting (blind count).')}
          </p>
          <div className="flex justify-end gap-2">
            <Button id="start-count-cancel" variant="outline" onClick={() => setStartOpen(false)}>
              {t('common.cancel', 'Cancel')}
            </Button>
            <Button id="start-count-submit" onClick={start} disabled={busy !== null}>
              {busy === 'start' ? t('counts.starting', 'Starting…') : t('counts.startCount', 'Start count')}
            </Button>
          </div>
        </div>
      </Dialog>

      {/* ---- Session detail ---- */}
      <Dialog
        isOpen={detail !== null}
        onClose={() => setDetail(null)}
        title={detail ? t('counts.detailTitle', 'Count — {{location}}', { location: detail.location_name || detail.location_id }) : t('counts.count', 'Count')}
        id="count-session-dialog"
        className="max-w-4xl"
      >
        {detail && (
          <div className="space-y-4 p-1">
            <div className="flex items-center justify-between">
              <Badge variant={(STATUS_BADGES[detail.status] ?? { variant: 'secondary' }).variant as BadgeVariant} size="sm">
                {(STATUS_BADGES[detail.status] ?? { label: detail.status }).label}
              </Badge>
              <div className="flex gap-2">
                {detail.status === 'in_progress' && (
                  <Button id="count-submit-review" size="sm" disabled={busy !== null} onClick={submit}>
                    {busy === 'submit' ? t('counts.submitting', 'Submitting…') : t('counts.submitForReview', 'Submit for review')}
                  </Button>
                )}
                {detail.can_review && (detail.status === 'review' || detail.status === 'in_progress') && (
                  <Button id="count-approve" size="sm" disabled={busy !== null} onClick={approve}>
                    {busy === 'approve' ? t('counts.approving', 'Approving…') : t('counts.approveApply', 'Approve & apply')}
                  </Button>
                )}
                {(detail.status === 'in_progress' || detail.status === 'review') && (
                  <Button id="count-cancel-session" variant="ghost" size="sm" disabled={busy !== null} onClick={cancel}>
                    {t('counts.cancelCount', 'Cancel count')}
                  </Button>
                )}
              </div>
            </div>

            {detail.lines.length === 0 ? (
              <p className="text-sm text-gray-500">{t('counts.noProducts', 'No tracked products at this location.')}</p>
            ) : (
              <div className="space-y-3">
                {detail.lines.map((line) => {
                  const unexpected = unexpectedSerials(line);
                  return (
                    <div key={line.service_id} className="border rounded p-3 space-y-2" id={`count-line-${line.service_id}`}>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">{line.service_name || line.service_id}</span>
                        {line.sku && <span className="text-xs text-gray-500">{line.sku}</span>}
                        {line.stale && (
                          <Badge variant="warning" size="sm">
                            {t('counts.staleBadge', 'Stale — stock moved, recount')}
                          </Badge>
                        )}
                        {detail.can_review && (
                          <span className="ml-auto text-sm text-gray-600 tabular-nums">
                            {t('counts.expected', 'Expected {{qty}}', { qty: line.expected_qty_visible })}
                            {line.variance != null && (
                              <span className={line.variance === 0 ? 'text-gray-500' : line.variance > 0 ? 'text-green-700' : 'text-red-700'}>
                                {' '}{t('counts.varianceLabel', '· variance')} {line.variance > 0 ? '+' : ''}
                                {line.variance}
                                {line.variance_value_cents != null && line.variance !== 0 && ` (${money(line.variance_value_cents, line.cost_currency ?? defaultCurrencyCode)})`}
                              </span>
                            )}
                          </span>
                        )}
                        {!detail.can_review && line.counted_qty != null && (
                          <span className="ml-auto text-sm text-gray-600 tabular-nums">{t('counts.counted', 'Counted {{qty}}', { qty: line.counted_qty })}</span>
                        )}
                      </div>

                      {line.is_serialized ? (
                        <TextArea
                          id={`count-serials-${line.service_id}`}
                          label={t('counts.fields.serialsLabel', 'Serials present (one per line)')}
                          rows={3}
                          disabled={!editable}
                          value={entries[line.service_id] ?? ''}
                          onChange={(e) => setEntries((prev) => ({ ...prev, [line.service_id]: e.target.value }))}
                        />
                      ) : (
                        <div className="w-40">
                          <Input
                            id={`count-qty-${line.service_id}`}
                            label={t('counts.fields.countedQty', 'Counted quantity')}
                            type="number"
                            min={0}
                            disabled={!editable}
                            value={entries[line.service_id] ?? ''}
                            onChange={(e) => setEntries((prev) => ({ ...prev, [line.service_id]: e.target.value }))}
                          />
                        </div>
                      )}

                      {editable && (
                        <Button
                          id={`count-save-${line.service_id}`}
                          size="sm"
                          variant="outline"
                          disabled={busy !== null}
                          onClick={() => saveLine(line)}
                        >
                          {busy === `line:${line.service_id}` ? t('common.saving', 'Saving…') : t('counts.saveCount', 'Save count')}
                        </Button>
                      )}

                      {/* Unexpected serials need an explicit disposition before approval (F066). */}
                      {unexpected.length > 0 && (
                        <div className="space-y-1 border-t pt-2">
                          <p className="text-xs font-medium text-amber-700">
                            {t('counts.unexpectedPrompt', 'Unexpected serial(s) — choose what to do before approving:')}
                          </p>
                          {unexpected.map((serial) => (
                            <div key={serial} className="flex items-center gap-2 text-sm">
                              <span className="font-mono">{serial}</span>
                              <CustomSelect
                                id={`disposition-${line.service_id}-${serial}`}
                                value={dispositions[serial] ?? ''}
                                placeholder={t('counts.dispositionPlaceholder', 'Disposition…')}
                                onValueChange={(value) =>
                                  setDispositions((prev) => ({ ...prev, [serial]: value as 'add' | 'exclude' }))
                                }
                                options={[
                                  { value: 'add', label: t('counts.dispositionAdd', 'Add to stock (found unit)') },
                                  { value: 'exclude', label: t('counts.dispositionExclude', 'Exclude from this count') },
                                ]}
                              />
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            <div className="flex justify-end">
              <Button id="count-session-close" variant="outline" onClick={() => setDetail(null)}>
                {t('common.close', 'Close')}
              </Button>
            </div>
          </div>
        )}
      </Dialog>
    </div>
  );
}
