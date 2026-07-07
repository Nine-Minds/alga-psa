'use client';

import React from 'react';
import { PackagePlus, Plus } from 'lucide-react';
import { Button } from '@alga-psa/ui/components/Button';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import type { InventoryDashboardData } from '../actions/inventoryDashboardActions';
import { AttentionStream } from './dashboard/AttentionStream';
import { FooterStrip } from './dashboard/FooterStrip';
import { MoneyBand } from './dashboard/MoneyBand';
import { DeploymentsTile, GhostUsageTile, PipelineTile, ReceivingTile } from './dashboard/RailTiles';
import { CurrencyFormatProvider, useCurrencyFormat } from './dashboard/shared';

interface InventoryDashboardProps {
  data: InventoryDashboardData;
}

const EMPTY: InventoryDashboardData = {
  currency_code: 'USD',
  header: {
    branch_count: 0,
    van_count: 0,
    tech_count: 0,
    attention_count: 0,
    urgent_count: 0,
    in_play_cents: 0,
  },
  unbilled: {
    total: 0,
    top_so: null,
    other_so: { count: 0, amount: 0 },
    dropship: { so_count: 0, amount: 0 },
    ghost: { count: 0, amount: null },
  },
  margin_mtd: {
    revenue: 0,
    cogs: 0,
    margin: 0,
    margin_pct: 0,
    prev_month_pct: null,
    price_creep: null,
  },
  rma_receivables: { total: 0, oldest_days: null, rows: [], more_count: 0 },
  attention: [],
  deployments: [],
  pipeline: {
    quotes: { count: 0, amount: 0 },
    booked: { count: 0, draft_count: 0, amount: 0 },
    fulfilling: { count: 0, amount: 0, blocked_count: 0 },
    invoiced_week: 0,
  },
  receiving_today: { count: 0, amount: 0, more_week: 0, pos: [], flag: null },
  ghost_week: { count: 0, est_total: null, techs: [] },
  footer: {
    value: 0,
    wow_delta: 0,
    on_hand_units: 0,
    serialized_units: 0,
    dead_stock: null,
    week: { received: 0, deployed: 0, transfers: 0, rmas: 0 },
  },
};

function pluralUnit(count: number, singular: string, plural: string): string {
  return `${count.toLocaleString()} ${count === 1 ? singular : plural}`;
}

export function InventoryDashboard({ data }: InventoryDashboardProps) {
  const { i18n } = useTranslation('features/inventory');
  const d = data ?? EMPTY;
  return (
    <CurrencyFormatProvider currencyCode={d.currency_code ?? 'USD'} locale={i18n.language || 'en'}>
      <InventoryDashboardBody data={d} />
    </CurrencyFormatProvider>
  );
}

function InventoryDashboardBody({ data: d }: InventoryDashboardProps) {
  const { t } = useTranslation('features/inventory');
  const { money } = useCurrencyFormat();
  const header = d.header ?? EMPTY.header;

  const subtitle = t(
    'dashboard.header.subtitle',
    '{{branches}} · {{vans}} · {{techs}} — {{attention}} need attention, {{inPlay}} in play today.',
    {
      branches: pluralUnit(header.branch_count, t('dashboard.header.branch', 'branch'), t('dashboard.header.branches', 'branches')),
      vans: pluralUnit(header.van_count, t('dashboard.header.van', 'van'), t('dashboard.header.vans', 'vans')),
      techs: pluralUnit(header.tech_count, t('dashboard.header.tech', 'tech'), t('dashboard.header.techs', 'techs')),
      attention: header.attention_count.toLocaleString(),
      inPlay: money(header.in_play_cents),
    },
  );

  return (
    <div id="inventory-dashboard-page" className="space-y-4 p-4 md:p-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight text-[rgb(var(--color-text-900))]">
            {t('dashboard.title', 'Inventory')}
          </h1>
          <p className="mt-1 max-w-3xl text-sm text-[rgb(var(--color-text-500))]">{subtitle}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 md:flex-shrink-0">
          <Button
            id="inventory-dashboard-receive-stock"
            label={t('dashboard.actions.receiveStock', 'Receive stock')}
            variant="outline"
            size="sm"
            asChild
          >
            <a href="/msp/inventory/stock">
              <PackagePlus className="h-4 w-4" />
              {t('dashboard.actions.receiveStock', 'Receive stock')}
            </a>
          </Button>
          <Button
            id="inventory-dashboard-new-purchase-order"
            label={t('dashboard.actions.newPurchaseOrder', 'New purchase order')}
            size="sm"
            asChild
          >
            <a href="/msp/inventory/purchase-orders">
              <Plus className="h-4 w-4" />
              {t('dashboard.actions.newPurchaseOrder', 'New purchase order')}
            </a>
          </Button>
        </div>
      </div>

      <MoneyBand data={d} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.4fr_1fr] lg:items-start">
        <AttentionStream items={d.attention} urgentCount={header.urgent_count} />
        <div className="flex min-w-0 flex-col gap-4">
          {d.deployments.length > 0 ? <DeploymentsTile deployments={d.deployments} /> : null}
          <PipelineTile pipeline={d.pipeline} />
          <ReceivingTile receiving={d.receiving_today} />
          <GhostUsageTile ghost={d.ghost_week} />
        </div>
      </div>

      <FooterStrip footer={d.footer} />
    </div>
  );
}
