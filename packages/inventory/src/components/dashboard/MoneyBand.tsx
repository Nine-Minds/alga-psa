'use client';

import React from 'react';
import { Percent, ReceiptText, RotateCcw } from 'lucide-react';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import type { InventoryDashboardData } from '../../actions/inventoryDashboardActions';
import { AgePill, Dot, Eyebrow, HeroTile, IconChip, TileLink, clientHref, pct, useCurrencyFormat } from './shared';

interface MoneyBandProps {
  data: InventoryDashboardData;
}

function BreakdownRow({
  id,
  tone,
  label,
  href,
  meta,
  value,
}: {
  id: string;
  tone: 'red' | 'amber' | 'info' | 'primary';
  label: string;
  href?: string;
  meta?: string;
  value: string;
}) {
  const content = href ? (
    <a id={`${id}-link`} href={href} className="truncate font-medium text-[rgb(var(--color-primary-600))] hover:underline">
      {label}
    </a>
  ) : (
    <span className="truncate text-[rgb(var(--color-text-700))]">{label}</span>
  );
  return (
    <div id={id} className="flex min-w-0 items-center justify-between gap-3 text-xs">
      <span className="flex min-w-0 items-center gap-2">
        <Dot tone={tone} />
        {content}
        {meta ? <span className="hidden flex-shrink-0 text-[rgb(var(--color-text-400))] sm:inline">{meta}</span> : null}
      </span>
      <span className="flex-shrink-0 font-mono font-medium text-[rgb(var(--color-text-900))]">{value}</span>
    </div>
  );
}

function UnbilledTile({ data }: { data: InventoryDashboardData['unbilled'] }) {
  const { t } = useTranslation('features/inventory');
  const { money } = useCurrencyFormat();
  const top = data.top_so;
  return (
    <HeroTile id="inventory-dashboard-unbilled-tile" accent="red">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Eyebrow tone="red">{t('dashboard.money.unbilled.title', 'Unbilled but shipped')}</Eyebrow>
          <div className="mt-2 font-mono text-3xl font-semibold leading-none text-[rgb(var(--color-text-900))]">
            {money(data.total)}
          </div>
        </div>
        <IconChip tone="red">
          <ReceiptText className="h-4 w-4" />
        </IconChip>
      </div>

      <div className="mt-4 flex flex-col gap-2 border-t border-red-100 pt-3 dark:border-red-900/50">
        {top ? (
          <BreakdownRow
            id="inventory-dashboard-unbilled-top-so"
            tone="red"
            label={top.client_name ?? top.so_number}
            href={clientHref(top.client_id)}
            meta={top.so_number}
            value={money(top.amount)}
          />
        ) : (
          <BreakdownRow
            id="inventory-dashboard-unbilled-empty-so"
            tone="red"
            label={t('dashboard.money.unbilled.noShippedSos', 'No shipped SOs waiting')}
            value={money(0)}
          />
        )}
        {data.other_so.count > 0 ? (
          <BreakdownRow
            id="inventory-dashboard-unbilled-other-sos"
            tone="red"
            label={t('dashboard.money.unbilled.otherSos', '{{count}} more shipped SOs', { count: data.other_so.count })}
            href="/msp/inventory/sales-orders"
            value={money(data.other_so.amount)}
          />
        ) : null}
        <BreakdownRow
          id="inventory-dashboard-unbilled-dropship"
          tone="amber"
          label={t('dashboard.money.unbilled.dropship', 'Drop-ships not invoiced')}
          meta={t('dashboard.money.unbilled.soCount', '{{count}} SOs', { count: data.dropship.so_count })}
          href="/msp/inventory/sales-orders"
          value={money(data.dropship.amount)}
        />
        <BreakdownRow
          id="inventory-dashboard-unbilled-ghost"
          tone="info"
          label={t('dashboard.money.unbilled.ghost', 'Ghost usage')}
          meta={t('dashboard.money.unbilled.ticketCount', '{{count}} tickets', { count: data.ghost.count })}
          href="/msp/inventory/ghost-usage"
          value={data.ghost.amount == null ? t('dashboard.money.estUnavailable', 'count only') : money(data.ghost.amount)}
        />
      </div>

      <div className="mt-auto pt-4">
        <TileLink id="inventory-dashboard-unbilled-ledger-link" href="/msp/inventory/margin">
          {t('dashboard.money.unbilled.ledgerLink', 'View revenue ledger')}
        </TileLink>
      </div>
    </HeroTile>
  );
}

function MarginTile({ data }: { data: InventoryDashboardData['margin_mtd'] }) {
  const { t } = useTranslation('features/inventory');
  const { money } = useCurrencyFormat();
  const delta = data.prev_month_pct == null ? null : data.margin_pct - data.prev_month_pct;
  return (
    <HeroTile id="inventory-dashboard-margin-tile">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Eyebrow>{t('dashboard.money.margin.title', 'Margin MTD')}</Eyebrow>
          <div className="mt-2 flex flex-wrap items-baseline gap-2">
            <span className="text-3xl font-bold leading-none text-[rgb(var(--color-text-900))]">{pct(data.margin_pct, 1)}</span>
            {delta != null ? (
              <span
                className={
                  delta >= 0
                    ? 'text-xs font-semibold text-green-600 dark:text-green-400'
                    : 'text-xs font-semibold text-red-600 dark:text-red-400'
                }
              >
                {delta >= 0 ? '+' : ''}
                {pct(delta, 1)} {t('dashboard.money.margin.vsLastMonth', 'vs last mo')}
              </span>
            ) : null}
          </div>
        </div>
        <IconChip tone="amber">
          <Percent className="h-4 w-4" />
        </IconChip>
      </div>

      <p className="mt-4 font-mono text-xs leading-5 text-[rgb(var(--color-text-500))]">
        {t('dashboard.money.margin.meta', '{{margin}} margin · {{revenue}} rev · {{cogs}} COGS', {
          margin: money(data.margin),
          revenue: money(data.revenue),
          cogs: money(data.cogs),
        })}
      </p>

      {data.price_creep ? (
        <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900 dark:border-amber-900 dark:bg-amber-500/15 dark:text-amber-200">
          {t('dashboard.money.margin.priceCreep', '{{count}} quote(s) and {{sos}} still at old cost — {{amount}} margin at risk.', {
            count: data.price_creep.quote_count,
            sos: data.price_creep.so_numbers.length
              ? data.price_creep.so_numbers.join(' · ')
              : t('dashboard.money.margin.noSos', 'no open SOs'),
            amount: money(data.price_creep.at_risk),
          })}
        </div>
      ) : null}
    </HeroTile>
  );
}

function RmaTile({ data }: { data: InventoryDashboardData['rma_receivables'] }) {
  const { t } = useTranslation('features/inventory');
  const { money } = useCurrencyFormat();
  return (
    <HeroTile id="inventory-dashboard-rma-receivables-tile">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Eyebrow>{t('dashboard.money.rma.title', 'Vendor-owed (RMA credits)')}</Eyebrow>
          <div className="mt-2 flex flex-wrap items-baseline gap-2">
            <span className="font-mono text-3xl font-semibold leading-none text-[rgb(var(--color-text-900))]">{money(data.total)}</span>
            {data.oldest_days != null ? (
              <span className="text-xs font-semibold text-red-600 dark:text-red-400">
                {t('dashboard.money.rma.oldest', '{{days}}d oldest', { days: data.oldest_days })}
              </span>
            ) : null}
          </div>
        </div>
        <IconChip tone="red">
          <RotateCcw className="h-4 w-4" />
        </IconChip>
      </div>

      <div className="mt-4 flex flex-col gap-2 border-t border-[rgb(var(--color-border-100))] pt-3">
        {data.rows.length === 0 ? (
          <p className="text-sm text-[rgb(var(--color-text-400))]">{t('dashboard.money.rma.empty', 'No vendor RMAs are aging.')}</p>
        ) : (
          data.rows.map((row) => (
            <div key={row.rma_id} className="flex min-w-0 items-center justify-between gap-3 text-xs">
              <span className="min-w-0 truncate">
                <a id={`inventory-dashboard-rma-${row.rma_id}`} href="/msp/inventory/rma" className="font-medium text-[rgb(var(--color-primary-600))] hover:underline">
                  {row.vendor_name ?? t('dashboard.money.rma.vendorFallback', 'Vendor')}
                </a>
                <span className="ml-1 text-[rgb(var(--color-text-500))]">
                  {row.rma_reference ? t('dashboard.money.rma.creditRef', 'credit · {{ref}}', { ref: row.rma_reference }) : t('dashboard.money.rma.credit', 'credit')}
                </span>
              </span>
              <span className="flex flex-shrink-0 items-center gap-2">
                <span className="font-mono font-medium text-[rgb(var(--color-text-900))]">
                  {row.amount == null ? t('common.emptyValue', '—') : money(row.amount)}
                </span>
                <AgePill days={row.age_days} />
              </span>
            </div>
          ))
        )}
      </div>

      <div className="mt-auto pt-4">
        <TileLink id="inventory-dashboard-rma-link" href="/msp/inventory/rma">
          {t('dashboard.money.rma.link', 'Chase all RMAs')}
        </TileLink>
      </div>
    </HeroTile>
  );
}

export function MoneyBand({ data }: MoneyBandProps) {
  return (
    <div id="inventory-dashboard-money-band" className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <UnbilledTile data={data.unbilled} />
      <MarginTile data={data.margin_mtd} />
      <RmaTile data={data.rma_receivables} />
    </div>
  );
}
