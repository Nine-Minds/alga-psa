'use client';

import React from 'react';
import { CalendarClock, PackageOpen, Route, Siren } from 'lucide-react';
import { BentoTile } from '@alga-psa/ui/components/bento/BentoTile';
import { cn } from '@alga-psa/ui/lib/utils';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import type { InventoryDashboardData } from '../../actions/inventoryDashboardActions';
import { SectionEmpty, TileLink, clientHref, count, money, pct, shortDate, weekdayDate } from './shared';

type Deployment = InventoryDashboardData['deployments'][number];
type Pipeline = InventoryDashboardData['pipeline'];
type Receiving = InventoryDashboardData['receiving_today'];
type Ghost = InventoryDashboardData['ghost_week'];

function statusLabel(status: Deployment['status'], t: ReturnType<typeof useTranslation>['t']) {
  switch (status) {
    case 'at_risk':
      return t('dashboard.deployments.status.atRisk', 'At risk');
    case 'ready':
      return t('dashboard.deployments.status.ready', 'Ready');
    case 'staging':
      return t('dashboard.deployments.status.staging', 'Staging');
  }
}

function statusClasses(status: Deployment['status']): string {
  switch (status) {
    case 'at_risk':
      return 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-500/15 dark:text-amber-300';
    case 'ready':
      return 'border-green-200 bg-green-50 text-green-700 dark:border-green-900 dark:bg-green-500/15 dark:text-green-300';
    case 'staging':
      return 'border-[rgb(var(--color-primary-200))] bg-[rgb(var(--color-primary-50))] text-[rgb(var(--color-primary-700))] dark:bg-[rgb(var(--color-primary-400)/0.15)] dark:text-primary-300';
  }
}

function DeploymentRow({ deployment }: { deployment: Deployment }) {
  const { t } = useTranslation('features/inventory');
  const fill = Math.min(Math.max(deployment.readiness_pct, 0), 100);
  const backorder = deployment.ordered > 0 ? Math.min(100 - fill, Math.round((deployment.backordered / deployment.ordered) * 100)) : 0;
  const scope = deployment.top_line
    ? t('dashboard.deployments.scope', '{{qty}}× {{name}} — {{staged}} staged · {{backordered}} backordered', {
        qty: deployment.top_line.qty,
        name: deployment.top_line.service_name ?? t('dashboard.deployments.itemFallback', 'item'),
        staged: deployment.staged,
        backordered: deployment.backordered,
      })
    : t('dashboard.deployments.scopeFallback', '{{staged}} staged · {{backordered}} backordered', {
        staged: deployment.staged,
        backordered: deployment.backordered,
      });
  return (
    <div id={`inventory-dashboard-deployment-${deployment.so_id}`} className="border-t border-[rgb(var(--color-border-100))] py-3 first:border-t-0 first:pt-0 last:pb-0">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <a
          id={`inventory-dashboard-deployment-link-${deployment.so_id}`}
          href={clientHref(deployment.client_id)}
          className="min-w-0 truncate text-sm font-semibold text-[rgb(var(--color-text-800))] hover:text-[rgb(var(--color-primary-600))] hover:underline"
        >
          {deployment.client_name ?? deployment.so_number}
        </a>
        <span className="font-mono text-[11px] text-[rgb(var(--color-text-500))]">{shortDate(deployment.ship_date)}</span>
        <span className="rounded bg-[rgb(var(--color-border-100))] px-1.5 py-0.5 font-mono text-[10px] text-[rgb(var(--color-text-500))]">
          {deployment.days_out >= 0 ? `T-${deployment.days_out}` : `T+${Math.abs(deployment.days_out)}`}
        </span>
        <span className={cn('rounded-full border px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide', statusClasses(deployment.status))}>
          {statusLabel(deployment.status, t)}
        </span>
        <span
          className={cn(
            'ml-auto flex-shrink-0 text-base font-bold',
            deployment.status === 'ready'
              ? 'text-green-600 dark:text-green-400'
              : deployment.status === 'at_risk'
                ? 'text-amber-700 dark:text-amber-300'
                : 'text-[rgb(var(--color-text-900))]',
          )}
        >
          {pct(deployment.readiness_pct)}
        </span>
      </div>
      <div className="mt-2 flex h-2.5 overflow-hidden rounded-full bg-[rgb(var(--color-border-100))]">
        <div className="bg-[rgb(var(--color-primary-500))]" style={{ width: `${fill}%` }} />
        {backorder > 0 ? (
          <div
            className="bg-amber-100 text-amber-500 dark:bg-amber-900/30 dark:text-amber-400"
            style={{
              width: `${backorder}%`,
              backgroundImage: 'repeating-linear-gradient(45deg, currentColor 0 4px, transparent 4px 8px)',
            }}
          />
        ) : null}
      </div>
      <p className="mt-2 text-xs text-[rgb(var(--color-text-600))]">{scope}</p>
      {deployment.feeder && deployment.status === 'at_risk' ? (
        <div className="mt-2 rounded-md border border-dashed border-amber-300 bg-amber-50 px-2.5 py-2 text-xs leading-5 text-amber-800 dark:border-amber-900 dark:bg-amber-500/15 dark:text-amber-200">
          {t('dashboard.deployments.feeder', 'Fed by {{po}} {{vendor}}, ETA {{eta}} — {{slack}}d slack.', {
            po: deployment.feeder.po_number,
            vendor: deployment.feeder.vendor_name ?? t('dashboard.deployments.vendorFallback', 'vendor'),
            eta: deployment.feeder.eta ? weekdayDate(deployment.feeder.eta) : t('dashboard.deployments.noEta', 'no ETA'),
            slack: deployment.feeder.slack_days ?? 0,
          })}
        </div>
      ) : null}
    </div>
  );
}

export function DeploymentsTile({ deployments }: { deployments: Deployment[] }) {
  const { t } = useTranslation('features/inventory');
  return (
    <BentoTile
      id="inventory-dashboard-deployments"
      title={t('dashboard.deployments.title', "This week's deployments")}
      subtitle={t('dashboard.deployments.subtitle', '{{count}} dated cutover(s)', { count: deployments.length })}
      icon={<CalendarClock className="h-4 w-4" />}
      action={
        <span className="rounded bg-[rgb(var(--color-primary-50))] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[rgb(var(--color-primary-700))]">
          {t('dashboard.deployments.eyebrow', 'This week')}
        </span>
      }
    >
      <div className="space-y-0">
        {deployments.map((deployment) => (
          <DeploymentRow key={deployment.so_id} deployment={deployment} />
        ))}
      </div>
      <div className="mt-3">
        <TileLink id="inventory-dashboard-all-service-orders-link" href="/msp/inventory/sales-orders">
          {t('dashboard.deployments.allServiceOrders', 'All service orders')}
        </TileLink>
      </div>
    </BentoTile>
  );
}

function FunnelRow({
  id,
  label,
  value,
  amount,
  max,
  tone,
}: {
  id: string;
  label: string;
  value: string;
  amount: number;
  max: number;
  tone: 'primary' | 'amber' | 'green';
}) {
  const toneClass = {
    primary: 'bg-[rgb(var(--color-primary-500))]',
    amber: 'bg-amber-500',
    green: 'bg-green-500',
  }[tone];
  const width = max > 0 ? Math.max(12, Math.round((amount / max) * 100)) : 12;
  return (
    <div id={id} className="grid grid-cols-[70px_1fr_auto] items-center gap-2 text-xs">
      <span className="truncate text-[rgb(var(--color-text-500))]">{label}</span>
      <div className="h-6 rounded-md bg-[rgb(var(--color-border-100))]">
        <div className={cn('flex h-full items-center rounded-md px-2 text-[10px] font-semibold text-white', toneClass)} style={{ width: `${Math.min(width, 100)}%` }}>
          <span className="truncate">{value}</span>
        </div>
      </div>
      <span className="font-mono text-xs font-medium text-[rgb(var(--color-text-800))]">{money(amount)}</span>
    </div>
  );
}

export function PipelineTile({ pipeline }: { pipeline: Pipeline }) {
  const { t } = useTranslation('features/inventory');
  const max = Math.max(pipeline.quotes.amount, pipeline.booked.amount, pipeline.fulfilling.amount, pipeline.invoiced_week, 1);
  return (
    <BentoTile id="inventory-dashboard-pipeline" title={t('dashboard.pipeline.title', 'Sales-order pipeline')} icon={<Route className="h-4 w-4" />}>
      <div>
        <div className="flex flex-wrap items-baseline gap-2">
          <span className="font-mono text-2xl font-semibold text-[rgb(var(--color-text-900))]">{money(pipeline.booked.amount)}</span>
          <span className="text-xs text-[rgb(var(--color-text-500))]">
            {t('dashboard.pipeline.openSos', '{{count}} open SOs', { count: pipeline.booked.count })}
          </span>
        </div>
        <div className="mt-4 space-y-2">
          <FunnelRow
            id="inventory-dashboard-pipeline-quotes"
            label={t('dashboard.pipeline.quotes', 'Quote')}
            value={t('dashboard.pipeline.quotesValue', '{{count}} open', { count: pipeline.quotes.count })}
            amount={pipeline.quotes.amount}
            max={max}
            tone="primary"
          />
          <FunnelRow
            id="inventory-dashboard-pipeline-booked"
            label={t('dashboard.pipeline.booked', 'SO booked')}
            value={t('dashboard.pipeline.bookedValue', '{{count}} · {{draft}} draft', {
              count: pipeline.booked.count,
              draft: pipeline.booked.draft_count,
            })}
            amount={pipeline.booked.amount}
            max={max}
            tone="primary"
          />
          <FunnelRow
            id="inventory-dashboard-pipeline-fulfilling"
            label={t('dashboard.pipeline.fulfilling', 'Fulfilling')}
            value={t('dashboard.pipeline.fulfillingValue', '{{count}} backorder', { count: pipeline.fulfilling.blocked_count })}
            amount={pipeline.fulfilling.amount}
            max={max}
            tone="amber"
          />
          <FunnelRow
            id="inventory-dashboard-pipeline-invoiced"
            label={t('dashboard.pipeline.invoiced', 'Invoiced')}
            value={t('dashboard.pipeline.invoicedValue', 'this wk')}
            amount={pipeline.invoiced_week}
            max={max}
            tone="green"
          />
        </div>
        {pipeline.fulfilling.blocked_count > 0 ? (
          <p className="mt-3 text-xs text-amber-700 dark:text-amber-300">
            {t('dashboard.pipeline.blocked', '{{count}} SOs blocked on backorder', { count: pipeline.fulfilling.blocked_count })}
          </p>
        ) : null}
        <div className="mt-3">
          <TileLink id="inventory-dashboard-all-sos-link" href="/msp/inventory/sales-orders">
            {t('dashboard.pipeline.allSos', 'All SOs')}
          </TileLink>
        </div>
      </div>
    </BentoTile>
  );
}

export function ReceivingTile({ receiving }: { receiving: Receiving }) {
  const { t } = useTranslation('features/inventory');
  return (
    <BentoTile id="inventory-dashboard-receiving-today" title={t('dashboard.receivingToday.title', 'Receiving today')} icon={<PackageOpen className="h-4 w-4" />}>
      <div>
        <div className="flex flex-wrap items-baseline gap-2">
          <span className="text-3xl font-bold leading-none text-[rgb(var(--color-text-900))]">{count(receiving.count)}</span>
          <span className="text-xs text-[rgb(var(--color-text-500))]">
            {t('dashboard.receivingToday.meta', 'POs · {{amount}} · {{more}} more this wk', {
              amount: money(receiving.amount),
              more: receiving.more_week,
            })}
          </span>
        </div>
        <div className="mt-4 divide-y divide-[rgb(var(--color-border-100))]">
          {receiving.pos.length === 0 ? (
            <SectionEmpty id="inventory-dashboard-receiving-empty">{t('dashboard.receivingToday.empty', 'No purchase orders land today.')}</SectionEmpty>
          ) : (
            receiving.pos.map((po) => (
              <div key={po.po_id} className="flex min-w-0 items-center justify-between gap-3 py-2 text-xs first:pt-0 last:pb-0">
                <span className="min-w-0 truncate">
                  <a id={`inventory-dashboard-receiving-po-${po.po_id}`} href="/msp/inventory/purchase-orders" className="font-medium text-[rgb(var(--color-primary-600))] hover:underline">
                    {po.po_number}
                  </a>
                  <span className="ml-1 text-[rgb(var(--color-text-600))]">{po.vendor_name ?? t('dashboard.receivingToday.vendorFallback', 'Vendor')}</span>
                </span>
                <span className="flex-shrink-0 font-mono font-medium text-[rgb(var(--color-text-900))]">{money(po.amount)}</span>
              </div>
            ))
          )}
        </div>
        {receiving.flag ? (
          <div className="mt-3 rounded-md bg-red-50 px-3 py-2 text-xs leading-5 text-red-800 dark:bg-red-500/15 dark:text-red-300">
            {t('dashboard.receivingToday.flag', 'Flag: {{po}} lands with {{slack}}d slack before {{client}} cutover.', {
              po: receiving.flag.po_number,
              slack: receiving.flag.slack_days,
              client: receiving.flag.client_name ?? t('dashboard.receivingToday.clientFallback', 'client'),
            })}
          </div>
        ) : null}
        <div className="mt-3">
          <TileLink id="inventory-dashboard-receive-stock-link" href="/msp/inventory/stock">
            {t('dashboard.receivingToday.receiveStock', 'Receive stock')}
          </TileLink>
        </div>
      </div>
    </BentoTile>
  );
}

export function GhostUsageTile({ ghost }: { ghost: Ghost }) {
  const { t } = useTranslation('features/inventory');
  return (
    <BentoTile id="inventory-dashboard-ghost-week" title={t('dashboard.ghostWeek.title', 'Ghost usage this week')} icon={<Siren className="h-4 w-4" />}>
      <div>
        <div className="flex flex-wrap items-baseline gap-2">
          <span className="text-3xl font-bold leading-none text-[rgb(var(--color-text-900))]">{count(ghost.count)}</span>
          <span className="text-xs text-[rgb(var(--color-text-500))]">
            {ghost.est_total == null
              ? t('dashboard.ghostWeek.countOnly', 'tickets closed, 0 parts')
              : t('dashboard.ghostWeek.est', 'tickets closed, 0 parts · est. {{amount}}', { amount: money(ghost.est_total) })}
          </span>
        </div>
        <p className="mt-3 text-sm leading-5 text-[rgb(var(--color-text-600))]">
          {t('dashboard.ghostWeek.explainer', 'Hardware tickets closed with no material posted — unbilled labor-only closes by tech.')}
        </p>
        <div className="mt-3 flex flex-wrap gap-1.5 border-t border-[rgb(var(--color-border-100))] pt-3">
          {ghost.techs.length === 0 ? (
            <span className="text-sm text-[rgb(var(--color-text-400))]">{t('dashboard.ghostWeek.empty', 'No ghost usage candidates this week.')}</span>
          ) : (
            ghost.techs.map((tech) => (
              <span
                key={tech.name}
                className="rounded-full border border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-border-50))] px-2 py-1 text-[11px] font-medium text-[rgb(var(--color-text-700))]"
              >
                {t('dashboard.ghostWeek.techChip', '{{name}} · {{count}}{{amount}}', {
                  name: tech.name,
                  count: tech.count,
                  amount: tech.est == null ? '' : ` · ${money(tech.est)}`,
                })}
              </span>
            ))
          )}
        </div>
        <div className="mt-3">
          <TileLink id="inventory-dashboard-ghost-usage-link" href="/msp/inventory/ghost-usage">
            {t('dashboard.ghostWeek.review', 'Review ghost usage')}
          </TileLink>
        </div>
      </div>
    </BentoTile>
  );
}
