'use client';

import React from 'react';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import type { InventoryDashboardData } from '../../actions/inventoryDashboardActions';
import { TileLink, count, money } from './shared';

interface FooterStripProps {
  footer: InventoryDashboardData['footer'];
}

function Divider() {
  return <span className="hidden h-5 w-px flex-shrink-0 bg-[rgb(var(--color-border-200))] md:block" />;
}

function Stat({
  label,
  value,
  detail,
}: {
  label: string;
  value: React.ReactNode;
  detail?: React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-wrap items-baseline gap-2 text-xs text-[rgb(var(--color-text-500))]">
      <span className="font-semibold uppercase tracking-wider text-[10px] text-[rgb(var(--color-text-400))]">{label}</span>
      <span className="font-mono font-medium text-[rgb(var(--color-text-800))]">{value}</span>
      {detail ? <span className="text-[rgb(var(--color-text-500))]">{detail}</span> : null}
    </div>
  );
}

export function FooterStrip({ footer }: FooterStripProps) {
  const { t } = useTranslation('features/inventory');
  const deltaPositive = footer.wow_delta >= 0;
  return (
    <section
      id="inventory-dashboard-health-footer"
      className="flex flex-col gap-3 rounded-lg border border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-card))] px-4 py-3 md:flex-row md:flex-wrap md:items-center"
    >
      <Stat
        label={t('dashboard.footer.title', 'Inventory health')}
        value={money(footer.value)}
        detail={
          <span
            className={
              deltaPositive
                ? 'inline-flex items-center gap-1 font-semibold text-green-600 dark:text-green-400'
                : 'inline-flex items-center gap-1 font-semibold text-red-600 dark:text-red-400'
            }
          >
            {deltaPositive ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
            {money(Math.abs(footer.wow_delta))} {t('dashboard.footer.weekAbbrev', 'wk')}
          </span>
        }
      />
      <Divider />
      <Stat
        label={t('dashboard.footer.onHand', 'On-hand units')}
        value={count(footer.on_hand_units)}
        detail={t('dashboard.footer.serialized', '{{count}} serialized', { count: footer.serialized_units })}
      />
      {footer.dead_stock ? (
        <>
          <Divider />
          <Stat
            label={t('dashboard.footer.deadStock', 'Dead stock')}
            value={money(footer.dead_stock.amount)}
            detail={
              <span className="font-semibold text-amber-700 dark:text-amber-300">
                {t('dashboard.footer.deadStockDetail', '{{location}} · 90d', {
                  location: footer.dead_stock.location_name ?? t('dashboard.footer.locationFallback', 'Location'),
                })}
              </span>
            }
          />
        </>
      ) : null}
      <Divider />
      <Stat
        label={t('dashboard.footer.thisWeek', 'This week')}
        value={t('dashboard.footer.weekActivity', '{{received}} received · {{deployed}} deployed · {{transfers}} transfers · {{rmas}} RMAs', {
          received: count(footer.week.received),
          deployed: count(footer.week.deployed),
          transfers: count(footer.week.transfers),
          rmas: count(footer.week.rmas),
        })}
      />
      <div className="md:ml-auto">
        <TileLink id="inventory-dashboard-valuation-report-link" href="/msp/inventory/margin">
          {t('dashboard.footer.valuationReport', 'Valuation report')}
        </TileLink>
      </div>
    </section>
  );
}
