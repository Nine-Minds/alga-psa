import { getInventoryDashboardData } from '@alga-psa/inventory/actions';
import type { InventoryDashboardData } from '@alga-psa/inventory/actions';
import { InventoryDashboard } from '@alga-psa/inventory/components';
import { getSession } from '@alga-psa/auth';
import { getErrorMessage, isActionMessageError, isActionPermissionError } from '@alga-psa/ui/lib/errorHandling';
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { enforceServerProductRoute } from '@/lib/serverProductRouteGuard';

export const metadata: Metadata = {
  title: 'Inventory',
};

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
    value_by_currency: [],
    wow_delta: 0,
    wow_delta_by_currency: [],
    on_hand_units: 0,
    serialized_units: 0,
    dead_stock: null,
    week: { received: 0, deployed: 0, transfers: 0, rmas: 0 },
  },
};

export default async function InventoryDashboardPage() {
  const boundary = await enforceServerProductRoute({ pathname: '/msp/inventory', scope: 'msp' });
  if (boundary) {
    return boundary;
  }

  const session = await getSession();
  if (!session?.user) {
    redirect('/auth/msp/signin');
  }

  let data: InventoryDashboardData = EMPTY;
  let loadError = false;
  try {
    const result = await getInventoryDashboardData();
    if (isActionMessageError(result) || isActionPermissionError(result)) {
      console.error('inventory dashboard: getInventoryDashboardData failed', getErrorMessage(result));
    } else {
      data = result;
    }
  } catch (err) {
    loadError = true;
    console.error('inventory dashboard: getInventoryDashboardData failed', err);
  }

  return <InventoryDashboard data={data} loadError={loadError} />;
}

export const dynamic = 'force-dynamic';
