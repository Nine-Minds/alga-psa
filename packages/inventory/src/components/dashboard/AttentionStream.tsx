'use client';

import React from 'react';
import { AlertTriangle, ArrowRight, FileText, ListChecks, Package, ReceiptText, RotateCcw, Truck } from 'lucide-react';
import { BentoTile } from '@alga-psa/ui/components/bento/BentoTile';
import { cn } from '@alga-psa/ui/lib/utils';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import type {
  AttentionActionKey,
  AttentionBand,
  AttentionCategory,
  AttentionItem,
  AttentionKind,
} from '../../actions/inventoryDashboardActions';
import { AgePill, Dot, count, money, moneySigned, shortDate } from './shared';

type Filter = 'all' | AttentionCategory;

interface AttentionStreamProps {
  items: AttentionItem[];
  urgentCount: number;
}

const FILTERS: Filter[] = ['all', 'money', 'fulfillment', 'field', 'ops'];
const BANDS: AttentionBand[] = ['red', 'amber', 'info'];

function param(item: AttentionItem, key: string): string {
  const value = item.params[key];
  return value == null ? '' : String(value);
}

function paramNumber(item: AttentionItem, key: string): number {
  const value = item.params[key];
  return typeof value === 'number' ? value : Number(value ?? 0);
}

function formatMaybeDate(value: string): string {
  return value ? shortDate(value) : '';
}

function actionLabel(key: AttentionActionKey, t: ReturnType<typeof useTranslation>['t']): string {
  const labels: Record<AttentionActionKey, string> = {
    invoice: t('dashboard.attention.actions.invoice', 'Invoice'),
    viewSo: t('dashboard.attention.actions.viewSo', 'View SO'),
    trackTransfer: t('dashboard.attention.actions.trackTransfer', 'Track transfer'),
    recall: t('dashboard.attention.actions.recall', 'Recall'),
    review: t('dashboard.attention.actions.review', 'Review'),
    chase: t('dashboard.attention.actions.chase', 'Chase'),
    openStaging: t('dashboard.attention.actions.openStaging', 'Open staging'),
    requote: t('dashboard.attention.actions.requote', 'Re-quote'),
    reviewBill: t('dashboard.attention.actions.reviewBill', 'Review bill'),
    approve: t('dashboard.attention.actions.approve', 'Approve'),
    reorder: t('dashboard.attention.actions.reorder', 'Reorder'),
    createPo: t('dashboard.attention.actions.createPo', 'Create PO'),
    receive: t('dashboard.attention.actions.receive', 'Receive'),
    shipReplacement: t('dashboard.attention.actions.shipReplacement', 'Ship replacement'),
    view: t('dashboard.attention.actions.view', 'View'),
  };
  return labels[key];
}

function filterLabel(filter: Filter, t: ReturnType<typeof useTranslation>['t']): string {
  const labels: Record<Filter, string> = {
    all: t('dashboard.attention.filters.all', 'All'),
    money: t('dashboard.attention.filters.money', 'Money'),
    fulfillment: t('dashboard.attention.filters.fulfillment', 'Fulfillment'),
    field: t('dashboard.attention.filters.field', 'Field'),
    ops: t('dashboard.attention.filters.ops', 'Ops'),
  };
  return labels[filter];
}

function bandLabel(band: AttentionBand, t: ReturnType<typeof useTranslation>['t']): string {
  const labels: Record<AttentionBand, string> = {
    red: t('dashboard.attention.bands.red', 'Costs money or a customer today'),
    amber: t('dashboard.attention.bands.amber', 'Worth chasing this week'),
    info: t('dashboard.attention.bands.info', 'Keep an eye on'),
  };
  return labels[band];
}

function kindLabel(item: AttentionItem, t: ReturnType<typeof useTranslation>['t']): string {
  const atRisk = paramNumber(item, 'at_risk') === 1;
  const labels: Record<AttentionKind, string> = {
    unbilled_so: t('dashboard.attention.kind.unbilled', 'unbilled'),
    unbilled_dropship: t('dashboard.attention.kind.dropship', 'drop-ship'),
    cutover: atRisk ? t('dashboard.attention.kind.cutoverRisk', 'at-risk cutover') : t('dashboard.attention.kind.cutover', 'cutover'),
    van_shortage: t('dashboard.attention.kind.vanShortage', 'van shortage'),
    overdue_loaner: t('dashboard.attention.kind.loaner', 'overdue loaner'),
    ghost_tech: t('dashboard.attention.kind.ghost', 'ghost usage'),
    rma_vendor: t('dashboard.attention.kind.rmaAging', 'rma aging'),
    rma_client: t('dashboard.attention.kind.rmaClient', 'replacement'),
    price_creep_so: t('dashboard.attention.kind.priceCreep', 'price creep'),
    price_creep_quotes: t('dashboard.attention.kind.priceCreep', 'price creep'),
    price_creep_bill: t('dashboard.attention.kind.billCreep', 'bill creep'),
    bills_overdue: t('dashboard.attention.kind.billsOverdue', 'overdue bills'),
    count_approval: t('dashboard.attention.kind.countApproval', 'count approval'),
    stock_low: t('dashboard.attention.kind.stockLow', 'stock low'),
    stock_out: t('dashboard.attention.kind.stockOut', 'stock out'),
    po_partial: t('dashboard.attention.kind.poPartial', 'partial PO'),
    warranty: t('dashboard.attention.kind.warranty', 'warranty'),
    dead_stock: t('dashboard.attention.kind.deadStock', 'dead stock'),
  };
  return labels[item.kind];
}

function rowFact(item: AttentionItem, t: ReturnType<typeof useTranslation>['t']): string {
  switch (item.kind) {
    case 'unbilled_so':
      return t('dashboard.attention.fact.unbilledSo', 'shipped, still not invoiced');
    case 'unbilled_dropship':
      return t('dashboard.attention.fact.unbilledDropship', 'drop-ships not invoiced across {{count}} SOs', {
        count: paramNumber(item, 'so_count'),
      });
    case 'cutover':
      return paramNumber(item, 'at_risk') === 1
        ? t('dashboard.attention.fact.cutoverRisk', 'cutover {{date}} — {{backordered}} of {{ordered}} backordered', {
            date: formatMaybeDate(param(item, 'ship_date')),
            backordered: paramNumber(item, 'backordered'),
            ordered: paramNumber(item, 'ordered'),
          })
        : t('dashboard.attention.fact.cutoverStaging', 'cutover {{date}} — {{staged}} of {{ordered}} staged', {
            date: formatMaybeDate(param(item, 'ship_date')),
            staged: paramNumber(item, 'staged'),
            ordered: paramNumber(item, 'ordered'),
          });
    case 'van_shortage':
      return t('dashboard.attention.fact.vanShortage', '{{service}} shortage with {{jobs}} installs today', {
        service: param(item, 'service_name'),
        jobs: paramNumber(item, 'jobs_today'),
      });
    case 'overdue_loaner':
      return t('dashboard.attention.fact.overdueLoaner', '{{service}} loaner {{days}}d overdue', {
        service: param(item, 'service_name') || t('dashboard.attention.itemFallback', 'unit'),
        days: paramNumber(item, 'overdue_days'),
      });
    case 'ghost_tech':
      return t('dashboard.attention.fact.ghostTech', 'closed {{count}} hardware tickets, no parts billed', {
        count: paramNumber(item, 'count'),
      });
    case 'rma_vendor':
      return t('dashboard.attention.fact.rmaVendor', 'owes credit — no response {{days}} days', {
        days: paramNumber(item, 'age_days'),
      });
    case 'rma_client':
      return t('dashboard.attention.fact.rmaClient', 'replacement unit still owed');
    case 'price_creep_so':
      return t('dashboard.attention.fact.priceCreepSo', 'still priced at old cost');
    case 'price_creep_quotes':
      return t('dashboard.attention.fact.priceCreepQuotes', '{{count}} open quote(s) now below current cost', {
        count: paramNumber(item, 'count'),
      });
    case 'price_creep_bill':
      return t('dashboard.attention.fact.priceCreepBill', 'bill exceeds matching PO');
    case 'bills_overdue':
      return t('dashboard.attention.fact.billsOverdue', '{{count}} vendor bill(s) overdue', {
        count: paramNumber(item, 'count'),
      });
    case 'count_approval':
      return t('dashboard.attention.fact.countApproval', 'count variance needs approver');
    case 'stock_out':
      return t('dashboard.attention.fact.stockOut', '{{service}} is out of stock', { service: param(item, 'service_name') });
    case 'stock_low':
      return t('dashboard.attention.fact.stockLow', '{{service}} below reorder point', { service: param(item, 'service_name') });
    case 'po_partial':
      return t('dashboard.attention.fact.poPartial', 'partially received PO still open');
    case 'warranty':
      return t('dashboard.attention.fact.warranty', '{{count}} units warranty-expiring <30d', {
        count: paramNumber(item, 'count'),
      });
    case 'dead_stock':
      return t('dashboard.attention.fact.deadStock', 'no movement in 90 days');
  }
}

function rowMeta(item: AttentionItem, t: ReturnType<typeof useTranslation>['t']): string {
  switch (item.kind) {
    case 'unbilled_so':
      return t('dashboard.attention.meta.unbilledSo', '{{so}} · {{lines}} lines · shipped {{days}}d ago', {
        so: param(item, 'so_number'),
        lines: paramNumber(item, 'line_count'),
        days: paramNumber(item, 'shipped_days_ago'),
      });
    case 'unbilled_dropship':
      return t('dashboard.attention.meta.unbilledDropship', 'confirmed drop-ship lines ready for invoice');
    case 'cutover':
      return param(item, 'po_number')
        ? t('dashboard.attention.meta.cutoverFeeder', 'ETA {{po}} {{eta}} · {{slack}}d slack · readiness {{pct}}%', {
            po: param(item, 'po_number'),
            eta: formatMaybeDate(param(item, 'feeder_eta')),
            slack: paramNumber(item, 'slack_days'),
            pct: paramNumber(item, 'readiness_pct'),
          })
        : t('dashboard.attention.meta.cutover', '{{so}} · {{pct}}% readiness · {{days}}d out', {
            so: param(item, 'so_number'),
            pct: paramNumber(item, 'readiness_pct'),
            days: paramNumber(item, 'days_out'),
          });
    case 'van_shortage':
      return paramNumber(item, 'in_transit') === 1
        ? t('dashboard.attention.meta.vanShortageTransit', 'available {{available}} · transfer {{from}} dispatched', {
            available: paramNumber(item, 'available'),
            from: param(item, 'transfer_from'),
          })
        : t('dashboard.attention.meta.vanShortage', 'available {{available}} · reorder point {{reorder}}', {
            available: paramNumber(item, 'available'),
            reorder: paramNumber(item, 'reorder_point'),
          });
    case 'overdue_loaner':
      return t('dashboard.attention.meta.overdueLoaner', 'due {{date}}{{serial}}', {
        date: formatMaybeDate(param(item, 'due_at')),
        serial: param(item, 'serial_number') ? ` · ${param(item, 'serial_number')}` : '',
      });
    case 'ghost_tech':
      return t('dashboard.attention.meta.ghostTech', 'est. materials exposure from closed hardware tickets');
    case 'rma_vendor':
      return t('dashboard.attention.meta.rmaVendor', '{{ref}} · oldest open receivable', {
        ref: param(item, 'rma_reference') || t('dashboard.attention.refFallback', 'RMA'),
      });
    case 'rma_client':
      return t('dashboard.attention.meta.rmaClient', '{{ref}} · {{service}} · due in {{days}}d', {
        ref: param(item, 'rma_reference') || t('dashboard.attention.refFallback', 'RMA'),
        service: param(item, 'service_name'),
        days: paramNumber(item, 'days_remaining'),
      });
    case 'price_creep_so':
      return t('dashboard.attention.meta.priceCreepSo', '{{so}} · margin exposure if fulfilled as-is', {
        so: param(item, 'so_number'),
      });
    case 'price_creep_quotes':
      return t('dashboard.attention.meta.priceCreepQuotes', 'quote(s): {{numbers}}', {
        numbers: param(item, 'numbers') || t('dashboard.attention.noneFallback', 'none'),
      });
    case 'price_creep_bill':
      return t('dashboard.attention.meta.priceCreepBill', '{{bill}} · flagged vs matching PO', {
        bill: param(item, 'bill_number') || t('dashboard.attention.refFallback', 'bill'),
      });
    case 'bills_overdue':
      return t('dashboard.attention.meta.billsOverdue', 'oldest overdue {{days}}d', { days: item.age_days ?? 0 });
    case 'count_approval':
      return t('dashboard.attention.meta.countApproval', 'counted by {{name}} · four-eyes hold', {
        name: param(item, 'counted_by') || t('dashboard.attention.personFallback', 'someone'),
      });
    case 'stock_out':
    case 'stock_low':
      return t('dashboard.attention.meta.stockLevel', 'available {{available}} · reorder point {{reorder}}', {
        available: paramNumber(item, 'available'),
        reorder: paramNumber(item, 'reorder_point'),
      });
    case 'po_partial':
      return t('dashboard.attention.meta.poPartial', '{{po}} · {{received}} of {{ordered}} received · {{vendor}}', {
        po: param(item, 'po_number'),
        received: paramNumber(item, 'received'),
        ordered: paramNumber(item, 'ordered'),
        vendor: param(item, 'vendor_name') || t('dashboard.attention.vendorFallback', 'vendor'),
      });
    case 'warranty':
      return param(item, 'clients') || t('dashboard.attention.meta.warranty', '{{count}} clients', { count: paramNumber(item, 'client_count') });
    case 'dead_stock':
      return t('dashboard.attention.meta.deadStock', '{{locations}} location(s) tie up working capital', {
        locations: paramNumber(item, 'location_count'),
      });
  }
}

function metric(item: AttentionItem, t: ReturnType<typeof useTranslation>['t']) {
  if (item.amount_cents != null) {
    const signed = item.kind === 'count_approval' || item.kind === 'price_creep_bill';
    return {
      main: signed ? moneySigned(item.amount_cents) : money(item.amount_cents),
      sub: item.age_days != null ? t('dashboard.attention.metric.ageDays', '{{days}}d', { days: item.age_days }) : null,
      hot: item.band === 'red',
    };
  }
  if (item.kind === 'cutover') {
    return {
      main: t('dashboard.attention.metric.percent', '{{pct}}%', { pct: paramNumber(item, 'readiness_pct') }),
      sub: t('dashboard.attention.metric.daysOut', '{{days}}d out', { days: paramNumber(item, 'days_out') }),
      hot: item.band === 'red',
    };
  }
  if (item.kind === 'van_shortage') {
    return {
      main: t('dashboard.attention.metric.jobs', '{{count}} jobs', { count: paramNumber(item, 'jobs_today') }),
      sub: t('dashboard.attention.metric.today', 'today'),
      hot: item.band === 'red',
    };
  }
  if (item.kind === 'warranty') {
    return {
      main: t('dashboard.attention.metric.units', '{{count}} units', { count: paramNumber(item, 'count') }),
      sub: t('dashboard.attention.metric.ltThirty', '<30d'),
      hot: false,
    };
  }
  if (item.kind === 'stock_low' || item.kind === 'stock_out') {
    return {
      main: count(paramNumber(item, 'available')),
      sub: t('dashboard.attention.metric.available', 'available'),
      hot: item.band === 'red',
    };
  }
  return {
    main: item.age_days != null ? t('dashboard.attention.metric.ageDays', '{{days}}d', { days: item.age_days }) : '',
    sub: null,
    hot: item.band === 'red',
  };
}

function RowIcon({ item }: { item: AttentionItem }) {
  const cls = 'h-3.5 w-3.5';
  switch (item.kind) {
    case 'unbilled_so':
    case 'unbilled_dropship':
      return <ReceiptText className={cls} />;
    case 'cutover':
    case 'po_partial':
      return <FileText className={cls} />;
    case 'van_shortage':
      return <Truck className={cls} />;
    case 'rma_vendor':
    case 'rma_client':
      return <RotateCcw className={cls} />;
    case 'count_approval':
      return <ListChecks className={cls} />;
    default:
      return <Package className={cls} />;
  }
}

function AttentionRow({ item }: { item: AttentionItem }) {
  const { t } = useTranslation('features/inventory');
  const rowMetric = metric(item, t);
  const chipTone = {
    money: 'bg-red-50 text-red-700 dark:bg-red-500/15 dark:text-red-300',
    fulfillment: 'bg-primary-50 text-[rgb(var(--color-primary-700))] dark:bg-[rgb(var(--color-primary-400)/0.15)] dark:text-primary-300',
    field: 'bg-cyan-50 text-cyan-700 dark:bg-cyan-500/15 dark:text-cyan-300',
    ops: 'bg-[rgb(var(--color-border-100))] text-[rgb(var(--color-text-600))]',
  } satisfies Record<AttentionCategory, string>;
  const action = actionLabel(item.action.key, t);
  return (
    <div
      id={`inventory-dashboard-attention-row-${item.id}`}
      className="grid grid-cols-[auto_1fr_auto] gap-3 border-t border-[rgb(var(--color-border-100))] px-4 py-3 transition-colors hover:bg-[rgb(var(--color-primary-50)/0.45)] md:grid-cols-[auto_1fr_auto_auto]"
    >
      <div className="pt-4">
        <Dot tone={item.band === 'red' ? 'red' : item.band === 'amber' ? 'amber' : 'info'} />
      </div>
      <div className="min-w-0">
        <div className="mb-1.5 flex min-w-0 items-center gap-2">
          <span className={cn('inline-flex flex-shrink-0 items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-semibold lowercase', chipTone[item.category])}>
            <RowIcon item={item} />
            {kindLabel(item, t)}
          </span>
        </div>
        <div className="min-w-0 text-sm font-medium text-[rgb(var(--color-text-800))]">
          {item.name ? (
            <>
              {item.href ? (
                <a
                  id={`inventory-dashboard-attention-name-${item.id}`}
                  href={item.href}
                  className="font-semibold text-[rgb(var(--color-primary-600))] hover:underline"
                >
                  {item.name}
                </a>
              ) : (
                <span className="font-semibold">{item.name}</span>
              )}
              <span> — {rowFact(item, t)}</span>
            </>
          ) : (
            rowFact(item, t)
          )}
        </div>
        <div className="mt-1 truncate text-xs text-[rgb(var(--color-text-500))]">{rowMeta(item, t)}</div>
      </div>
      <div className="min-w-[72px] flex-shrink-0 text-right">
        <div className={cn('font-mono text-sm font-medium text-[rgb(var(--color-text-900))]', rowMetric.hot && 'text-red-600 dark:text-red-400')}>
          {rowMetric.main}
        </div>
        {rowMetric.sub ? <div className="mt-0.5 text-[11px] text-[rgb(var(--color-text-500))]">{rowMetric.sub}</div> : null}
      </div>
      <a
        id={`inventory-dashboard-attention-action-${item.id}`}
        href={item.action.href}
        className={cn(
          'col-span-2 inline-flex h-8 items-center justify-center gap-1.5 rounded-md border px-3 text-xs font-semibold transition-colors md:col-span-1',
          item.action.primary
            ? 'border-[rgb(var(--color-primary-500))] bg-[rgb(var(--color-primary-500))] text-white hover:bg-[rgb(var(--color-primary-600))]'
            : 'border-[rgb(var(--color-border-300))] text-[rgb(var(--color-primary-600))] hover:border-[rgb(var(--color-primary-300))] hover:bg-[rgb(var(--color-primary-50))]',
        )}
      >
        {action}
        <ArrowRight className="h-3.5 w-3.5" />
      </a>
    </div>
  );
}

export function AttentionStream({ items, urgentCount }: AttentionStreamProps) {
  const { t } = useTranslation('features/inventory');
  const [filter, setFilter] = React.useState<Filter>('all');
  const filtered = React.useMemo(
    () => (filter === 'all' ? items : items.filter((item) => item.category === filter)),
    [filter, items],
  );

  return (
    <BentoTile id="inventory-dashboard-attention-stream" className="min-w-0" title={undefined}>
      <div className="flex flex-col">
        <div className="flex flex-col gap-3 pb-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 items-center gap-2">
            <AlertTriangle className="h-4 w-4 flex-shrink-0 text-red-500" />
            <h2 className="truncate text-sm font-semibold text-[rgb(var(--color-text-800))]">
              {t('dashboard.attention.title', 'Needs attention')}
            </h2>
            {urgentCount > 0 ? (
              <span className="flex-shrink-0 rounded-full bg-red-50 px-2 py-0.5 text-xs font-semibold text-red-700 dark:bg-red-500/15 dark:text-red-300">
                {t('dashboard.attention.urgent', '{{count}} urgent', { count: urgentCount })}
              </span>
            ) : null}
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5 pb-2">
          {FILTERS.map((next) => (
            <button
              key={next}
              id={`inventory-dashboard-attention-filter-${next}`}
              type="button"
              onClick={() => setFilter(next)}
              className={cn(
                'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                filter === next
                  ? 'border-[rgb(var(--color-primary-500))] bg-[rgb(var(--color-primary-500))] text-white'
                  : 'border-[rgb(var(--color-border-300))] text-[rgb(var(--color-text-600))] hover:border-[rgb(var(--color-primary-300))] hover:bg-[rgb(var(--color-primary-50))]',
              )}
            >
              {filterLabel(next, t)}
            </button>
          ))}
        </div>

        {filtered.length === 0 ? (
          <div id="inventory-dashboard-attention-empty" className="border-t border-[rgb(var(--color-border-100))] py-8 text-center text-sm text-[rgb(var(--color-text-400))]">
            {t('dashboard.attention.allClear', 'All clear — nothing needs attention right now.')}
          </div>
        ) : (
          BANDS.map((band) => {
            const rows = filtered.filter((item) => item.band === band);
            if (rows.length === 0) return null;
            return (
              <section key={band} id={`inventory-dashboard-attention-band-${band}`}>
                <div className="flex items-center gap-2 border-t border-[rgb(var(--color-border-100))] px-4 py-2">
                  <Dot tone={band === 'red' ? 'red' : band === 'amber' ? 'amber' : 'info'} />
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-[rgb(var(--color-text-500))]">
                    {bandLabel(band, t)}
                  </div>
                  <div className="h-px flex-1 bg-[rgb(var(--color-border-100))]" />
                  <span className="text-xs text-[rgb(var(--color-text-500))]">{rows.length}</span>
                </div>
                <div>
                  {rows.map((item) => (
                    <AttentionRow key={item.id} item={item} />
                  ))}
                </div>
              </section>
            );
          })
        )}

        <div className="flex flex-col gap-2 border-t border-[rgb(var(--color-border-100))] px-4 py-3 text-xs text-[rgb(var(--color-text-500))] sm:flex-row sm:items-center sm:justify-between">
          <span>{t('dashboard.attention.footer', 'Ranked by dollar + customer impact · refreshed just now')}</span>
          <AgePill days={null} />
        </div>
      </div>
    </BentoTile>
  );
}
