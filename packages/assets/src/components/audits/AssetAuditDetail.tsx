'use client';

import React, { useCallback, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ClipboardCheck, Download, Search } from 'lucide-react';
import { toast } from 'react-hot-toast';
import type {
  AssetAuditItemRecord,
  AssetAuditItemResult,
  AssetTypeRegistryEntry,
  ColumnDefinition,
  ITicket,
} from '@alga-psa/types';
import useSWR from 'swr';
import { useClientDrawer } from '@alga-psa/ui';
import {
  BentoChip,
  BentoLabelValue,
  BentoStat,
  BentoTile,
  BentoTileEmpty,
} from '@alga-psa/ui/components/bento';
import BackNav from '@alga-psa/ui/components/BackNav';
import { Button } from '@alga-psa/ui/components/Button';
import { AsyncSearchableSelect } from '@alga-psa/ui/components/AsyncSearchableSelect';
import { CustomTabs } from '@alga-psa/ui/components/CustomTabs';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import { Dialog, DialogContent, DialogFooter } from '@alga-psa/ui/components/Dialog';
import { Input } from '@alga-psa/ui/components/Input';
import { isActionPermissionError } from '@alga-psa/ui/lib/errorHandling';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import {
  addUnexpectedAuditAsset,
  cancelAssetAudit,
  completeAssetAudit,
  markAssetAuditItem,
  unmarkAssetAuditItem,
} from '../../actions/assetAuditActions';
import { listAssets } from '../../actions/assetActions';
import { unwrapAssetActionResult } from '../../actions/assetActionErrors';
import { getAssetTypes } from '../../actions/assetTypeRegistryActions';
import { fallbackAssetTypeLabel, resolveAssetTypeLabel } from '../../lib/assetTypeDisplay';
import { isBuiltinAssetTypeSlug } from '../../lib/assetTypeAttributes';
import { useAssetStatusLabel } from '../../lib/assetStatus';
import { useAssetStatusRegistry } from '../shared/useAssetStatusOptions';
import { useAssetCrossFeature } from '../../context/AssetCrossFeatureContext';
import {
  auditErrorText,
  auditGenericErrorText,
  auditMethodLabel,
  auditOutcome,
  auditResultLabel,
  auditResultTone,
  auditStatusLabel,
  auditStatusTone,
  formatAuditDate,
  formatAuditDateTime,
  formatAuditRef,
  useAssetAuditCapability,
  useAssetAuditDetail,
} from './auditClient';

type Segment = 'remaining' | 'present' | 'missing' | 'unexpected' | 'all';

const SEGMENTS: Segment[] = ['remaining', 'present', 'missing', 'unexpected', 'all'];

/** A site walk is a long list, so the items table starts wider than the table default of 10. */
const DEFAULT_ITEMS_PER_PAGE = 25;

/** Which results a segment shows. `remaining` is the walk's to-do list. */
const SEGMENT_RESULTS: Record<Segment, AssetAuditItemResult[] | null> = {
  remaining: ['expected'],
  present: ['present'],
  missing: ['missing'],
  unexpected: ['unexpected'],
  all: null,
};

/**
 * The segment on screen. A closed run has no remaining items — completing one
 * turns every unmarked `expected` into `missing`, and cancelling leaves nothing
 * to walk — so a finished audit opens on every item instead of on an empty
 * to-do list, and a `remaining` choice carried over from the walk is dropped
 * the moment the run closes.
 */
export function effectiveAuditSegment(choice: Segment | null, isOpenRun: boolean): Segment {
  if (isOpenRun) return choice ?? 'remaining';
  return choice && choice !== 'remaining' ? choice : 'all';
}

/** One CSV cell: quoted, with embedded quotes doubled. */
function csvCell(value: string | number | null | undefined): string {
  const text = value == null ? '' : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

export interface AssetAuditDetailProps {
  auditId: string;
  id?: string;
}

/**
 * One site audit: the scope and counts it was opened with, every asset it
 * looked for, and — while it is open — the marks, the out-of-scope additions
 * and the two ways to close it.
 *
 * The same run can be walked on a phone at the same time, so the detail
 * revalidates on focus and polls while the status is `in_progress`: a scan made
 * in the van shows up here without a reload.
 */
export function AssetAuditDetail({ auditId, id = 'asset-audit' }: AssetAuditDetailProps) {
  const { t, i18n } = useTranslation('msp/assets');
  const router = useRouter();
  // Provided by MspClientDrawerProvider in WorkspaceProviders, so it is present
  // on every /msp route. Optional by design — the name reads as plain text
  // wherever no drawer host is mounted.
  const clientDrawer = useClientDrawer();
  const crossFeature = useAssetCrossFeature();
  const { canUpdate } = useAssetAuditCapability();
  const { data: audit, error, isLoading, mutate } = useAssetAuditDetail(auditId);

  const [segmentChoice, setSegmentChoice] = useState<Segment | null>(null);
  const [search, setSearch] = useState('');
  const [itemsPage, setItemsPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(DEFAULT_ITEMS_PER_PAGE);
  const [busyAssetId, setBusyAssetId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirmComplete, setConfirmComplete] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const [ticketFor, setTicketFor] = useState<AssetAuditItemRecord | null>(null);

  const { data: assetTypes } = useSWR<AssetTypeRegistryEntry[]>([id, 'asset-types'], async () => {
    const entries = await getAssetTypes();
    return isActionPermissionError(entries) ? [] : entries;
  });

  // The scope is stored as status slugs; the header reads them the way every
  // other asset surface does — the tenant's own label, or the translated
  // builtin — so `held_by_msp` never reaches the screen.
  const { statuses: assetStatuses } = useAssetStatusRegistry();
  const statusLabel = useAssetStatusLabel(assetStatuses);

  const items = audit?.items ?? [];
  const isOpenRun = audit?.status === 'in_progress';
  const mayAct = Boolean(isOpenRun && canUpdate);
  const segment = effectiveAuditSegment(segmentChoice, isOpenRun);
  // "Remaining" is a question only an open run can answer, so a closed one is
  // not offered it at all.
  const segments = isOpenRun ? SEGMENTS : SEGMENTS.filter((key) => key !== 'remaining');

  const counts = useMemo(() => {
    const base: Record<Segment, number> = {
      remaining: 0,
      present: 0,
      missing: 0,
      unexpected: 0,
      all: items.length,
    };
    for (const item of items) {
      if (item.result === 'expected') base.remaining += 1;
      else if (item.result === 'present') base.present += 1;
      else if (item.result === 'missing') base.missing += 1;
      else if (item.result === 'unexpected') base.unexpected += 1;
    }
    return base;
  }, [items]);

  const visibleItems = useMemo(() => {
    const allowed = SEGMENT_RESULTS[segment];
    const term = search.trim().toLowerCase();
    return items.filter((item) => {
      if (allowed && !allowed.includes(item.result)) return false;
      if (!term) return true;
      return [item.asset_name, item.asset_tag, item.serial_number]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(term));
    });
  }, [items, segment, search]);

  const runAction = useCallback(
    async (assetId: string | null, action: () => Promise<unknown>) => {
      setBusyAssetId(assetId);
      setActionError(null);
      // A site walk runs on whatever connectivity the building has: a dropped
      // request, a database error or a server-action transport failure *throws*
      // rather than answering, so it is caught here. Without this the promise
      // rejects unhandled, the row stays disabled and nothing is said.
      try {
        const outcome = auditOutcome<unknown>(await action());
        if (!outcome.ok) {
          setActionError(auditErrorText(t, outcome));
          return false;
        }
        // Every write returns the whole audit, but the key is mutated rather
        // than written from the response so a mark made elsewhere in the
        // meantime is picked up in the same round trip.
        await mutate();
        return true;
      } catch {
        setActionError(auditGenericErrorText(t));
        return false;
      } finally {
        setBusyAssetId(null);
      }
    },
    [mutate, t],
  );

  /**
   * Built-ins keep their i18n labels, a custom slug resolves through the tenant
   * registry — the same ladder the asset list and the client Assets tab use, so
   * the raw slug never reaches the table.
   */
  const assetTypeLabel = useCallback(
    (slug: string | null | undefined) => {
      if (!slug) return '—';
      if (isBuiltinAssetTypeSlug(slug)) {
        return t(`assetDashboardClient.types.${slug}`, { defaultValue: fallbackAssetTypeLabel(slug) });
      }
      return resolveAssetTypeLabel(assetTypes, slug);
    },
    [assetTypes, t],
  );

  const exportCsv = useCallback(() => {
    if (visibleItems.length === 0) {
      toast(t('assetAudits.detail.exportEmpty', { defaultValue: 'There is nothing to export in this view.' }));
      return;
    }
    const header = [
      t('assetAudits.items.columns.asset', { defaultValue: 'Asset' }),
      t('assetAudits.items.columns.type', { defaultValue: 'Type' }),
      t('assetAudits.items.columns.serial', { defaultValue: 'Serial / tag' }),
      t('assetAudits.items.columns.result', { defaultValue: 'Result' }),
      t('assetAudits.items.columns.method', { defaultValue: 'Method' }),
      t('assetAudits.items.columns.markedBy', { defaultValue: 'Marked by' }),
      t('assetAudits.items.columns.markedAt', { defaultValue: 'Marked at' }),
    ];
    const rows = visibleItems.map((item) => [
      csvCell(item.asset_name),
      csvCell(assetTypeLabel(item.asset_type)),
      csvCell([item.serial_number, item.asset_tag].filter(Boolean).join(' / ')),
      csvCell(auditResultLabel(t, item.result)),
      csvCell(item.method ? auditMethodLabel(t, item.method) : ''),
      csvCell(item.marked_by_name),
      csvCell(item.marked_at ? formatAuditDateTime(item.marked_at, i18n?.language) : ''),
    ]);
    const csv = [header.map(csvCell).join(','), ...rows.map((row) => row.join(','))].join('\r\n');
    const url = URL.createObjectURL(new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `site-audit-${auditId}.csv`;
    // The anchor has to be in the document for the click to be honoured, and
    // the blob URL has to outlive it: revoking in the same tick cancels the
    // download the browser was only just handed, which is how this button came
    // to do nothing at all.
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    toast.success(t('assetAudits.detail.exportStarted', { defaultValue: 'CSV export started.' }));
  }, [visibleItems, assetTypeLabel, t, i18n?.language, auditId]);

  const loadAssetOptions = useCallback(
    async ({ search: term, page, limit }: { search: string; page: number; limit: number }) => {
      if (!audit) return { options: [], total: 0 };
      const response = unwrapAssetActionResult(
        await listAssets({ client_id: audit.client_id, search: term || undefined, page, limit }),
      );
      const known = new Set(items.map((item) => item.asset_id));
      const offered = response.assets.filter((asset) => !known.has(asset.asset_id));
      return {
        options: offered.map((asset) => ({
          value: asset.asset_id,
          label: asset.name,
          secondaryLabel: asset.asset_tag,
        })),
        total: Math.max(0, response.total - (response.assets.length - offered.length)),
      };
    },
    [audit, items],
  );

  const columns: ColumnDefinition<AssetAuditItemRecord>[] = useMemo(
    () => [
      {
        title: t('assetAudits.items.columns.asset', { defaultValue: 'Asset' }),
        dataIndex: 'asset_name',
        minWidth: '160px',
        render: (_value: unknown, row: AssetAuditItemRecord) => (
          <button
            id={`${id}-asset-link-${row.asset_id}`}
            type="button"
            className="min-w-0 text-left text-[rgb(var(--color-primary-600))] hover:underline"
            onClick={(event) => {
              event.stopPropagation();
              router.push(`/msp/assets/${row.asset_id}`);
            }}
          >
            <span className="block truncate font-medium">{row.asset_name || row.asset_id}</span>
          </button>
        ),
      },
      {
        title: t('assetAudits.items.columns.type', { defaultValue: 'Type' }),
        dataIndex: 'asset_type',
        minWidth: '110px',
        render: (value: unknown) => assetTypeLabel(value as string | null),
      },
      {
        title: t('assetAudits.items.columns.serial', { defaultValue: 'Serial / tag' }),
        dataIndex: 'serial_number',
        minWidth: '120px',
        render: (_value: unknown, row: AssetAuditItemRecord) => (
          <span className="font-mono text-xs">
            {[row.serial_number, row.asset_tag].filter(Boolean).join(' / ') || '—'}
          </span>
        ),
      },
      {
        title: t('assetAudits.items.columns.result', { defaultValue: 'Result' }),
        dataIndex: 'result',
        minWidth: '104px',
        render: (value: unknown) => (
          <BentoChip tone={auditResultTone(value as AssetAuditItemResult)}>
            {auditResultLabel(t, value as AssetAuditItemResult)}
          </BentoChip>
        ),
      },
      {
        title: t('assetAudits.items.columns.method', { defaultValue: 'Method' }),
        dataIndex: 'method',
        minWidth: '96px',
        render: (value: unknown) => auditMethodLabel(t, value as string | null),
      },
      {
        title: t('assetAudits.items.columns.markedBy', { defaultValue: 'Marked by' }),
        dataIndex: 'marked_by_name',
        minWidth: '120px',
        render: (value: unknown) => (value as string) || '—',
      },
      {
        title: t('assetAudits.items.columns.markedAt', { defaultValue: 'Marked at' }),
        dataIndex: 'marked_at',
        minWidth: '130px',
        render: (value: unknown) => formatAuditDateTime(value as string | null, i18n?.language),
      },
      {
        title: t('assetAudits.items.columns.actions', { defaultValue: 'Actions' }),
        dataIndex: 'asset_id',
        sortable: false,
        width: '18%',
        minWidth: '180px',
        render: (_value: unknown, row: AssetAuditItemRecord) => (
          <div className="flex flex-wrap gap-1">
            {mayAct && row.result === 'expected' ? (
              <Button
                id={`${id}-mark-present-button-${row.asset_id}`}
                variant="outline"
                size="sm"
                disabled={busyAssetId === row.asset_id}
                onClick={(event) => {
                  event.stopPropagation();
                  void runAction(row.asset_id, () => markAssetAuditItem(auditId, row.asset_id));
                }}
              >
                {t('assetAudits.items.markPresent', { defaultValue: 'Mark present' })}
              </Button>
            ) : null}
            {mayAct && row.result !== 'expected' ? (
              <Button
                id={`${id}-undo-mark-button-${row.asset_id}`}
                variant="ghost"
                size="sm"
                disabled={busyAssetId === row.asset_id}
                onClick={(event) => {
                  event.stopPropagation();
                  void runAction(row.asset_id, () => unmarkAssetAuditItem(auditId, row.asset_id));
                }}
              >
                {t('assetAudits.items.undoMark', { defaultValue: 'Undo' })}
              </Button>
            ) : null}
            {row.result === 'missing' ? (
              <Button
                id={`${id}-create-ticket-button-${row.asset_id}`}
                variant="ghost"
                size="sm"
                onClick={(event) => {
                  event.stopPropagation();
                  setTicketFor(row);
                }}
              >
                {t('assetAudits.items.createTicket', { defaultValue: 'Create ticket' })}
              </Button>
            ) : null}
          </div>
        ),
      },
    ],
    [t, i18n?.language, assetTypeLabel, mayAct, busyAssetId, runAction, auditId, id, router],
  );

  if (error) {
    return (
      <div id={`${id}-error`} role="alert" className="p-6">
        <p className="text-sm text-[rgb(var(--color-accent-700))]">{auditErrorText(t, error)}</p>
        <Button id={`${id}-retry-button`} variant="outline" className="mt-3" onClick={() => void mutate()}>
          {t('common.actions.retry', { defaultValue: 'Retry' })}
        </Button>
      </div>
    );
  }

  if (isLoading && !audit) {
    return (
      <div id={`${id}-loading`} className="space-y-3 p-6">
        <div className="h-24 animate-pulse rounded-md bg-[rgb(var(--color-border-100))]" />
        <div className="h-64 animate-pulse rounded-md bg-[rgb(var(--color-border-100))]" />
      </div>
    );
  }

  if (!audit) return null;

  const scopeStatuses = Array.isArray(audit.statuses) ? audit.statuses : [];

  return (
    <div id={id} className="space-y-4 p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {/* Back goes where the run was opened from: the audits list. The client
            is one click away in the header, in its own drawer, so leaving this
            page is never the price of looking the client up. */}
        <BackNav id={`${id}-back-button`} href="/msp/assets/audits">
          ← {t('assetAudits.title', { defaultValue: 'Site audits' })}
        </BackNav>
        <div className="flex flex-wrap items-center gap-2">
          <Button id={`${id}-export-button`} variant="outline" size="sm" onClick={exportCsv}>
            <Download className="mr-1 h-4 w-4" />
            {t('assetAudits.detail.exportCsv', { defaultValue: 'Export CSV' })}
          </Button>
          {mayAct ? (
            <>
              <Button id={`${id}-add-unexpected-button`} variant="outline" size="sm" onClick={() => setAddOpen(true)}>
                {t('assetAudits.detail.addUnexpected', { defaultValue: 'Add unexpected asset' })}
              </Button>
              <Button
                id={`${id}-cancel-button`}
                variant="ghost"
                size="sm"
                onClick={() => setConfirmCancel(true)}
              >
                {t('assetAudits.detail.cancelAudit', { defaultValue: 'Cancel audit' })}
              </Button>
              <Button id={`${id}-complete-button`} size="sm" onClick={() => setConfirmComplete(true)}>
                {t('assetAudits.detail.complete', { defaultValue: 'Complete audit' })}
              </Button>
            </>
          ) : null}
        </div>
      </div>

      <BentoTile
        id={`${id}-header`}
        title={audit.client_name || t('assetAudits.detail.untitledClient', { defaultValue: 'Client' })}
        icon={<ClipboardCheck className="h-4 w-4" />}
        action={<BentoChip tone={auditStatusTone(audit.status)}>{auditStatusLabel(t, audit.status)}</BentoChip>}
      >
        <div className="mb-4 flex flex-wrap gap-6">
          <BentoStat
            id={`${id}-stat-expected`}
            value={audit.expected_count}
            label={t('assetAudits.stats.expected', { defaultValue: 'expected' })}
          />
          <BentoStat
            id={`${id}-stat-present`}
            value={counts.present}
            label={t('assetAudits.stats.present', { defaultValue: 'present' })}
          />
          <BentoStat
            id={`${id}-stat-missing`}
            value={isOpenRun ? counts.remaining : counts.missing}
            label={
              isOpenRun
                ? t('assetAudits.stats.remaining', { defaultValue: 'remaining' })
                : t('assetAudits.stats.missing', { defaultValue: 'missing' })
            }
          />
          <BentoStat
            id={`${id}-stat-unexpected`}
            value={counts.unexpected}
            label={t('assetAudits.stats.unexpected', { defaultValue: 'unexpected' })}
          />
        </div>
        <div className="grid grid-cols-1 gap-1.5 text-sm sm:grid-cols-2">
          {/* The client this run belongs to, opened in the quick-view drawer
              over this page rather than navigated to, so a walk in progress is
              never lost to a lookup. */}
          <BentoLabelValue
            id={`${id}-client`}
            label={t('assetAudits.columns.client', { defaultValue: 'Client' })}
            value={
              clientDrawer ? (
                <button
                  id={`${id}-client-link`}
                  type="button"
                  className="text-[rgb(var(--color-primary-600))] hover:underline"
                  onClick={() => clientDrawer.openClientDrawer(audit.client_id)}
                >
                  {audit.client_name || audit.client_id}
                </button>
              ) : (
                audit.client_name || audit.client_id
              )
            }
          />
          {/* The same handle the list shows in its first column, so a row and
              the page it opens can be told to be the same run. */}
          <BentoLabelValue
            id={`${id}-reference`}
            label={t('assetAudits.detail.reference', { defaultValue: 'Audit' })}
            value={formatAuditRef(audit.audit_id)}
          />
          <BentoLabelValue
            id={`${id}-location`}
            label={t('assetAudits.detail.location', { defaultValue: 'Location' })}
            value={
              audit.location_id
                ? audit.location_name || audit.location_id
                : t('assetAudits.noLocation', { defaultValue: 'No location' })
            }
          />
          <BentoLabelValue
            id={`${id}-started-by`}
            label={t('assetAudits.detail.startedBy', { defaultValue: 'Started by' })}
            value={audit.started_by_name || '—'}
          />
          <BentoLabelValue
            id={`${id}-started-at`}
            label={t('assetAudits.detail.started', { defaultValue: 'Started' })}
            value={formatAuditDateTime(audit.started_at, i18n?.language)}
          />
          <BentoLabelValue
            id={`${id}-completed-at`}
            label={t('assetAudits.detail.completed', { defaultValue: 'Completed' })}
            value={audit.completed_at ? formatAuditDateTime(audit.completed_at, i18n?.language) : '—'}
          />
          <BentoLabelValue
            id={`${id}-scope-statuses`}
            label={t('assetAudits.detail.scopeStatuses', { defaultValue: 'Statuses in scope' })}
            value={
              scopeStatuses.length > 0
                ? scopeStatuses.map((slug) => statusLabel(slug)).join(', ')
                : t('assetAudits.detail.allStatuses', { defaultValue: 'Every status' })
            }
          />
          {audit.notes ? (
            <BentoLabelValue
              id={`${id}-notes`}
              label={t('assetAudits.detail.notes', { defaultValue: 'Notes' })}
              value={audit.notes}
            />
          ) : null}
        </div>
      </BentoTile>

      {actionError ? (
        <div
          id={`${id}-action-error`}
          role="alert"
          className="rounded-md border border-[rgb(var(--color-accent-300))] bg-[rgb(var(--color-accent-50))] p-3 text-sm text-[rgb(var(--color-accent-900))]"
        >
          {actionError}
        </div>
      ) : null}

      <CustomTabs
        idPrefix={`${id}-segments`}
        value={segment}
        onTabChange={(value) => {
          setSegmentChoice(value as Segment);
          setItemsPage(1);
        }}
        tabs={segments.map((key) => ({
          id: key,
          label: (
            <span className="inline-flex items-center gap-1.5">
              {t(`assetAudits.segments.${key}`, {
                defaultValue:
                  key === 'remaining'
                    ? 'Remaining'
                    : key === 'present'
                      ? 'Present'
                      : key === 'missing'
                        ? 'Missing'
                        : key === 'unexpected'
                          ? 'Unexpected'
                          : 'All',
              })}
              <span className="rounded-full bg-[rgb(var(--color-border-100))] px-1.5 text-xs">{counts[key]}</span>
            </span>
          ),
          content: null,
        }))}
      />

      <div className="relative min-w-[220px] max-w-sm">
        <Search className="absolute left-3 top-2.5 h-4 w-4 text-[rgb(var(--color-text-500))]" aria-hidden="true" />
        <Input
          id={`${id}-item-search`}
          className="h-9 pl-9"
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setItemsPage(1);
          }}
          placeholder={t('assetAudits.items.searchPlaceholder', {
            defaultValue: 'Search by name, tag or serial',
          })}
        />
      </div>

      {visibleItems.length === 0 ? (
        <BentoTileEmpty id={`${id}-items-empty`}>
          {t('assetAudits.items.empty', { defaultValue: 'No assets in this view.' })}
        </BentoTileEmpty>
      ) : (
        // Every item of the run is already in hand, so the table pages over
        // them client-side. It has to be asked for: the table slices to its
        // page size whether or not the pager is shown, so `pagination={false}`
        // would quietly hide every asset past the first page.
        <DataTable
          id={`${id}-items-table`}
          data={visibleItems}
          columns={columns}
          pagination
          currentPage={itemsPage}
          pageSize={itemsPerPage}
          onPageChange={setItemsPage}
          onItemsPerPageChange={(size) => {
            setItemsPerPage(size);
            setItemsPage(1);
          }}
        />
      )}

      <Dialog
        id={`${id}-complete-dialog`}
        isOpen={confirmComplete}
        onClose={() => setConfirmComplete(false)}
        title={t('assetAudits.detail.complete', { defaultValue: 'Complete audit' })}
        className="max-w-md"
      >
        <DialogContent>
          <p className="text-sm text-[rgb(var(--color-text-700))]">
            {t('assetAudits.detail.completeConfirm', {
              defaultValue_one: '1 unmarked device will be recorded as missing.',
              defaultValue_other: '{{count}} unmarked devices will be recorded as missing.',
              count: counts.remaining,
            })}
          </p>
          <DialogFooter>
            <Button
              id={`${id}-complete-cancel-button`}
              variant="outline"
              onClick={() => setConfirmComplete(false)}
            >
              {t('common.actions.cancel', { defaultValue: 'Cancel' })}
            </Button>
            <Button
              id={`${id}-complete-confirm-button`}
              disabled={closing}
              onClick={async () => {
                setClosing(true);
                try {
                  const ok = await runAction(null, () => completeAssetAudit(auditId));
                  if (ok) setConfirmComplete(false);
                } finally {
                  // The confirm button must never latch: a failure has to leave
                  // the run closable again.
                  setClosing(false);
                }
              }}
            >
              {t('assetAudits.detail.complete', { defaultValue: 'Complete audit' })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        id={`${id}-cancel-dialog`}
        isOpen={confirmCancel}
        onClose={() => setConfirmCancel(false)}
        title={t('assetAudits.detail.cancelAudit', { defaultValue: 'Cancel audit' })}
        className="max-w-md"
      >
        <DialogContent>
          <p className="text-sm text-[rgb(var(--color-text-700))]">
            {t('assetAudits.detail.cancelConfirm', {
              defaultValue: 'The run is abandoned and nothing is written to the assets. This cannot be undone.',
            })}
          </p>
          <DialogFooter>
            <Button id={`${id}-cancel-dismiss-button`} variant="outline" onClick={() => setConfirmCancel(false)}>
              {t('assetAudits.detail.keepAudit', { defaultValue: 'Keep auditing' })}
            </Button>
            <Button
              id={`${id}-cancel-confirm-button`}
              disabled={closing}
              onClick={async () => {
                setClosing(true);
                try {
                  const ok = await runAction(null, () => cancelAssetAudit(auditId));
                  if (ok) setConfirmCancel(false);
                } finally {
                  setClosing(false);
                }
              }}
            >
              {t('assetAudits.detail.cancelAudit', { defaultValue: 'Cancel audit' })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* `allowOverflow` keeps the dialog body from scrolling the asset list out
          of sight: the picker is the whole point of this dialog, so its list has
          to be allowed to stand outside the body it is anchored in. */}
      <Dialog
        id={`${id}-add-unexpected-dialog`}
        isOpen={addOpen}
        onClose={() => setAddOpen(false)}
        title={t('assetAudits.detail.addUnexpected', { defaultValue: 'Add unexpected asset' })}
        className="max-w-xl"
        allowOverflow
      >
        <DialogContent>
          <p className="mb-2 text-sm text-[rgb(var(--color-text-600))]">
            {t('assetAudits.detail.addUnexpectedHint', {
              defaultValue:
                'A device found on site but outside this audit scope is recorded as unexpected, never as expected.',
            })}
          </p>
          <AsyncSearchableSelect
            id={`${id}-add-unexpected-select`}
            value=""
            onChange={async (assetId: string) => {
              const ok = await runAction(assetId, () => addUnexpectedAuditAsset(auditId, assetId));
              if (ok) setAddOpen(false);
            }}
            loadOptions={loadAssetOptions}
            limit={10}
            // Anchored to the dialog itself rather than to the scrollable body,
            // so the candidates are on screen the moment the list opens.
            dropdownMode="overlay"
            maxListHeight="16rem"
            placeholder={t('assetAudits.detail.addUnexpectedPlaceholder', { defaultValue: 'Find an asset…' })}
            searchPlaceholder={t('assetAudits.items.searchPlaceholder', {
              defaultValue: 'Search by name, tag or serial',
            })}
            emptyMessage={t('assetAudits.detail.addUnexpectedEmpty', {
              defaultValue: 'No other assets for this client.',
            })}
          />
          <DialogFooter>
            <Button id={`${id}-add-unexpected-cancel-button`} variant="outline" onClick={() => setAddOpen(false)}>
              {t('common.actions.cancel', { defaultValue: 'Cancel' })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Audit items carry an id, a name, a tag and a serial — not a full Asset
          — so the ticket comes from the cross-feature quick-add path, which
          takes exactly those. */}
      {ticketFor
        ? crossFeature.renderQuickAddTicket({
            open: true,
            onOpenChange: (open: boolean) => {
              if (!open) setTicketFor(null);
            },
            onTicketAdded: (_ticket?: ITicket) => setTicketFor(null),
            assetId: ticketFor.asset_id,
            assetName: ticketFor.asset_name ?? undefined,
            prefilledClient: { id: audit.client_id, name: audit.client_name ?? '' },
            prefilledTitle: t('assetAudits.items.ticketTitle', {
              defaultValue: 'Missing at site audit: {{asset}}',
              asset: ticketFor.asset_name ?? ticketFor.asset_id,
            }),
            prefilledDescription: t('assetAudits.items.ticketDescription', {
              defaultValue: 'Not found during the site audit started on {{date}}.',
              date: formatAuditDate(audit.started_at, i18n?.language),
            }),
          })
        : null}
    </div>
  );
}

export default AssetAuditDetail;
