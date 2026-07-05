'use client';

import React from 'react';
import {
  Package,
  AlertTriangle,
  RotateCcw,
  ShoppingCart,
  ShieldCheck,
  FileText,
  TrendingUp,
  DollarSign,
  Boxes,
  ArrowDownToLine,
  ArrowLeftRight,
  MapPin,
  Truck,
  Plus,
  ArrowRight,
} from 'lucide-react';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import type {
  InventoryDashboardData,
  AttentionItem,
  AttentionSeverity,
  ReceivingPo,
  DashboardMovement,
} from '../actions/inventoryDashboardActions';

interface InventoryDashboardProps {
  data: InventoryDashboardData;
}

/* ------------------------------- helpers -------------------------------- */

const EMPTY: InventoryDashboardData = {
  location_count: 0,
  van_count: 0,
  inventory_value: { by_location: [], grand_total: 0 },
  on_hand: { total_units: 0, serialized_units: 0 },
  on_order: { open_po_count: 0, on_order_value: 0, arriving_today: 0 },
  margin_mtd: { revenue: 0, cogs: 0, margin: 0, margin_pct: 0 },
  vendor_bills: { open_count: 0, open_total: 0, overdue_count: 0, overdue_total: 0 },
  this_week: { received: 0, deployed: 0, transfers: 0, rmas_opened: 0 },
  attention: [],
  receiving_queue: [],
  recent_movements: [],
};

function money(cents: number, dp = 0): string {
  return `$${(Number(cents || 0) / 100).toLocaleString(undefined, { minimumFractionDigits: dp, maximumFractionDigits: dp })}`;
}

const PILL: Record<string, string> = {
  err: 'bg-red-50 text-red-700 border-red-200',
  warn: 'bg-amber-50 text-amber-700 border-amber-200',
  info: 'bg-blue-50 text-blue-700 border-blue-200',
  ok: 'bg-green-50 text-green-700 border-green-200',
  muted: 'bg-gray-100 text-gray-600 border-gray-200',
};

function Pill({ tone, children }: { tone: keyof typeof PILL; children: React.ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11.5px] font-semibold whitespace-nowrap ${PILL[tone]}`}>
      {children}
    </span>
  );
}

const CHIP: Record<string, string> = {
  purple: 'bg-primary-50 text-primary-600',
  amber: 'bg-amber-50 text-amber-600',
  red: 'bg-red-50 text-red-600',
  green: 'bg-green-50 text-green-600',
  cyan: 'bg-cyan-50 text-cyan-600',
  gray: 'bg-gray-100 text-gray-500',
};

function Chip({ tone, size = 38, children }: { tone: keyof typeof CHIP; size?: number; children: React.ReactNode }) {
  return (
    <span
      className={`inline-flex items-center justify-center rounded-[10px] ${CHIP[tone]}`}
      style={{ width: size, height: size, flex: `0 0 ${size}px` }}
    >
      {children}
    </span>
  );
}

const SEV_DOT: Record<AttentionSeverity, string> = {
  red: 'bg-red-500',
  amber: 'bg-amber-500',
  info: 'bg-cyan-500',
};
const SEV_CHIP: Record<AttentionSeverity, keyof typeof CHIP> = { red: 'red', amber: 'amber', info: 'cyan' };

function attentionIcon(item: AttentionItem) {
  const cls = 'w-[18px] h-[18px]';
  switch (item.icon) {
    case 'rma':
      return <RotateCcw className={cls} />;
    case 'po':
      return <ShoppingCart className={cls} />;
    case 'warranty':
      return <ShieldCheck className={cls} />;
    case 'so':
      return <FileText className={cls} />;
    default:
      return <Package className={cls} />;
  }
}

function Btn({
  href,
  variant,
  children,
}: {
  href: string;
  variant: 'primary' | 'outline';
  children: React.ReactNode;
}) {
  const base =
    'inline-flex items-center gap-1.5 rounded-lg font-semibold whitespace-nowrap transition-colors';
  const styles =
    variant === 'primary'
      ? 'bg-primary-500 text-white hover:bg-primary-600'
      : 'bg-white border border-gray-300 text-gray-700 hover:bg-primary-50 hover:border-primary-300';
  return (
    <a href={href} className={`${base} ${styles} h-8 px-2.5 text-[12.5px]`}>
      {children}
    </a>
  );
}

/* ------------------------------- sections ------------------------------- */

function KpiTile({
  label,
  value,
  chipTone,
  icon,
  foot,
}: {
  label: string;
  value: string;
  chipTone: keyof typeof CHIP;
  icon: React.ReactNode;
  foot: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2.5 rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <span className="text-[12.5px] font-semibold text-gray-500">{label}</span>
        <Chip tone={chipTone} size={30}>
          {icon}
        </Chip>
      </div>
      <div className="text-[27px] font-bold leading-none tracking-tight text-gray-900">{value}</div>
      <div className="flex items-center justify-between gap-2">{foot}</div>
    </div>
  );
}

function MovementLine({ m }: { m: DashboardMovement }) {
  const { t } = useTranslation('features/inventory');
  const relTime = (d: string | Date): string => {
    const ts = new Date(d).getTime();
    if (Number.isNaN(ts)) return '';
    const s = Math.max(0, (Date.now() - ts) / 1000);
    if (s < 60) return t('dashboard.relTime.justNow', 'just now');
    const min = Math.floor(s / 60);
    if (min < 60) return t('dashboard.relTime.minAgo', '{{count}} min ago', { count: min });
    const hr = Math.floor(min / 60);
    if (hr < 24) return t('dashboard.relTime.hrAgo', '{{count}} hr ago', { count: hr });
    return t('dashboard.relTime.dayAgo', '{{count}}d ago', { count: Math.floor(hr / 24) });
  };
  const svc = m.service_name ?? t('dashboard.movements.itemFallback', 'item');
  let tone: keyof typeof CHIP = 'purple';
  let Icon = Package;
  let text: React.ReactNode = t('dashboard.movements.generic', '{{type}} {{qty}} × {{name}}', {
    type: m.movement_type,
    qty: m.quantity,
    name: svc,
  });
  const serial = m.serial_number ? t('dashboard.movements.serialSuffix', ' (SN {{sn}})', { sn: m.serial_number }) : '';
  switch (m.movement_type) {
    case 'receipt':
      tone = 'green';
      Icon = ArrowDownToLine;
      text = (
        <>
          <b className="font-bold">{t('dashboard.movements.received', 'Received')}</b> {m.quantity} × {svc}
          {m.to_location_name ? ` → ${m.to_location_name}` : ''}
        </>
      );
      break;
    case 'transfer_out':
    case 'transfer_in':
      tone = 'cyan';
      Icon = ArrowLeftRight;
      text = (
        <>
          <b className="font-bold">{t('dashboard.movements.transferred', 'Transferred')}</b> {m.quantity} × {svc}
          {m.to_location_name ? ` → ${m.to_location_name}` : ''}
        </>
      );
      break;
    case 'consume':
      tone = 'purple';
      Icon = FileText;
      text = (
        <>
          <b className="font-bold">{t('dashboard.movements.consumed', 'Consumed')}</b> {m.quantity} × {svc}
          {serial}
        </>
      );
      break;
    case 'rma_out':
    case 'return_defective':
    case 'rma_in':
      tone = 'red';
      Icon = RotateCcw;
      text = (
        <>
          <b className="font-bold">{t('dashboard.movements.rma', 'RMA')}</b> · {svc}
          {serial}
        </>
      );
      break;
    default:
      tone = 'gray';
      Icon = Package;
  }
  const where =
    m.movement_type === 'transfer_out' && m.from_location_name && m.to_location_name
      ? `${m.from_location_name} → ${m.to_location_name} · `
      : '';
  const src = m.source_doc_type ? `${m.source_doc_type.replace(/_/g, ' ')} · ` : '';
  const who = m.performed_by_name ? t('dashboard.movements.bySuffix', ' · by {{name}}', { name: m.performed_by_name }) : '';
  return (
    <div className="flex gap-3 px-[18px] py-2.5 [&+&]:border-t [&+&]:border-gray-100">
      <Chip tone={tone} size={30}>
        <Icon className="w-4 h-4" />
      </Chip>
      <div className="min-w-0">
        <div className="text-[13px] text-gray-800">{text}</div>
        <div className="text-[12px] text-gray-400 mt-0.5">
          {where || src}
          {relTime(m.created_at)}
          {who}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------- component ------------------------------ */

export function InventoryDashboard({ data }: InventoryDashboardProps) {
  const { t } = useTranslation('features/inventory');
  const d = data || EMPTY;
  const iv = d.inventory_value || EMPTY.inventory_value;
  const bills = d.vendor_bills || EMPTY.vendor_bills;
  const attention = d.attention || [];
  const queue = d.receiving_queue || [];
  const movements = d.recent_movements || [];

  const locationsText =
    d.location_count === 1
      ? t('dashboard.subtitle.location', '{{count}} location', { count: d.location_count })
      : t('dashboard.subtitle.locations', '{{count}} locations', { count: d.location_count });
  const vansText =
    d.van_count > 0
      ? d.van_count === 1
        ? t('dashboard.subtitle.van', ' & {{count}} field van', { count: d.van_count })
        : t('dashboard.subtitle.vans', ' & {{count}} field vans', { count: d.van_count })
      : '';
  const subtitle = `${locationsText}${vansText}`;

  return (
    <div className="p-6 space-y-[18px]" id="inventory-dashboard-page">
      {/* page head */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900">{t('dashboard.title', 'Inventory')}</h1>
          <p className="text-sm text-gray-500 mt-0.5">{t('dashboard.stockHealthAcross', 'Stock health across {{subtitle}}', { subtitle })}</p>
        </div>
        <div className="flex items-center gap-2.5">
          <a
            href="/msp/inventory/stock"
            className="inline-flex items-center gap-1.5 h-[38px] px-[15px] rounded-lg text-[13.5px] font-semibold bg-white border border-gray-300 text-gray-700 hover:bg-primary-50 hover:border-primary-300"
          >
            <ArrowDownToLine className="w-[15px] h-[15px]" /> {t('dashboard.actions.receiveStock', 'Receive stock')}
          </a>
          <a
            href="/msp/inventory/purchase-orders"
            className="inline-flex items-center gap-1.5 h-[38px] px-[15px] rounded-lg text-[13.5px] font-semibold bg-primary-500 text-white hover:bg-primary-600"
          >
            <ShoppingCart className="w-[15px] h-[15px]" /> {t('dashboard.actions.newPurchaseOrder', 'New purchase order')}
          </a>
        </div>
      </div>

      {/* KPI ribbon */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4" id="inventory-kpi-ribbon">
        <KpiTile
          label={t('dashboard.kpi.totalValue', 'Total inventory value')}
          value={money(iv.grand_total)}
          chipTone="green"
          icon={<DollarSign className="w-4 h-4" />}
          foot={
            <span className="text-[12px] text-gray-400">
              {iv.by_location.length === 1
                ? t('dashboard.kpi.stockedLocation', '{{count}} stocked location', { count: iv.by_location.length })
                : t('dashboard.kpi.stockedLocations', '{{count}} stocked locations', { count: iv.by_location.length })}
            </span>
          }
        />
        <KpiTile
          label={t('dashboard.kpi.onHandUnits', 'On-hand units')}
          value={d.on_hand.total_units.toLocaleString()}
          chipTone="purple"
          icon={<Boxes className="w-4 h-4" />}
          foot={
            <span className="text-[12px] text-gray-400">{t('dashboard.kpi.serialized', '{{count}} serialized', { count: d.on_hand.serialized_units })}</span>
          }
        />
        <KpiTile
          label={t('dashboard.kpi.onOrder', 'On order (open POs)')}
          value={money(d.on_order.on_order_value)}
          chipTone="cyan"
          icon={<Truck className="w-4 h-4" />}
          foot={
            <span className="text-[12px] text-gray-400">
              {d.on_order.open_po_count === 1
                ? t('dashboard.kpi.poCount', '{{count}} PO', { count: d.on_order.open_po_count })
                : t('dashboard.kpi.poCountPlural', '{{count}} POs', { count: d.on_order.open_po_count })}
              {d.on_order.arriving_today > 0 ? t('dashboard.kpi.arrivingToday', ' · {{count}} arriving today', { count: d.on_order.arriving_today }) : ''}
            </span>
          }
        />
        <KpiTile
          label={t('dashboard.kpi.marginMtd', 'Margin · month to date')}
          value={`${d.margin_mtd.margin_pct.toFixed(1)}%`}
          chipTone="green"
          icon={<TrendingUp className="w-4 h-4" />}
          foot={
            <span className="text-[12px] text-gray-400">
              {t('dashboard.kpi.marginFoot', '{{margin}} on {{revenue}}', { margin: money(d.margin_mtd.margin), revenue: money(d.margin_mtd.revenue) })}
            </span>
          }
        />
      </div>

      {/* vendor bills aging (F082) — the AP tie-out at a glance */}
      {bills.open_count > 0 && (
        <div
          className="flex items-center gap-3 rounded-lg border border-gray-200 bg-white shadow-sm px-[18px] py-3"
          id="inventory-vendor-bills-widget"
        >
          <span className="text-[13.5px] font-semibold text-gray-900">{t('dashboard.bills.title', 'Vendor bills owed')}</span>
          <span className="text-[13.5px] tabular-nums text-gray-700">
            {bills.open_count === 1
              ? t('dashboard.bills.acrossBill', '{{total}} across {{count}} bill', { total: money(bills.open_total), count: bills.open_count })
              : t('dashboard.bills.acrossBills', '{{total}} across {{count}} bills', { total: money(bills.open_total), count: bills.open_count })}
          </span>
          {bills.overdue_count > 0 ? (
            <span className="text-[12.5px] font-semibold text-red-600">
              {t('dashboard.bills.overdue', '{{count}} overdue · {{total}}', { count: bills.overdue_count, total: money(bills.overdue_total) })}
            </span>
          ) : (
            <span className="text-[12.5px] text-gray-400">{t('dashboard.bills.nothingOverdue', 'nothing overdue')}</span>
          )}
          <a href="/msp/inventory/vendor-bills" className="ml-auto text-[12.5px] font-semibold text-primary-600 hover:underline">
            {t('dashboard.bills.viewBills', 'View bills')}
          </a>
        </div>
      )}

      {/* attention + receiving */}
      <div className="grid grid-cols-1 lg:grid-cols-[1.55fr_1fr] gap-[18px]">
        {/* needs attention */}
        <section className="rounded-lg border border-gray-200 bg-white shadow-sm" id="inventory-needs-attention">
          <div className="flex items-center justify-between px-[18px] py-[15px] border-b border-gray-100">
            <h2 className="flex items-center gap-2.5 text-[15px] font-bold text-gray-900">
              <AlertTriangle className="w-[17px] h-[17px] text-red-500" /> {t('dashboard.attention.title', 'Needs attention')}
              {attention.length > 0 && (
                <span className="rounded-full border border-red-200 bg-red-50 px-2 py-px text-[11.5px] font-bold text-red-700">
                  {attention.length}
                </span>
              )}
            </h2>
          </div>
          <div className="flex flex-col">
            {attention.length === 0 && (
              <div className="px-[18px] py-10 text-center text-sm text-gray-400">
                {t('dashboard.attention.allClear', 'All clear — nothing needs attention right now.')}
              </div>
            )}
            {attention.map((item) => (
              <div key={item.id} className="flex items-center gap-3 px-[18px] py-[13px] border-b border-gray-100 last:border-b-0 hover:bg-gray-50">
                <span className={`w-2 h-2 rounded-full flex-none ${SEV_DOT[item.severity]}`} />
                <Chip tone={SEV_CHIP[item.severity]}>{attentionIcon(item)}</Chip>
                <div className="flex-1 min-w-0">
                  <div className="text-[13.5px] font-semibold text-gray-800 truncate">{item.title}</div>
                  <div className="text-[12.5px] text-gray-500 mt-px truncate">{item.subtitle}</div>
                </div>
                <div className="flex flex-col items-end gap-1.5 flex-none">
                  <Pill tone={item.badge.tone}>{item.badge.label}</Pill>
                  <Btn href={item.action.href} variant={item.action.primary ? 'primary' : 'outline'}>
                    {item.action.label}
                  </Btn>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* receiving queue + this week */}
        <section className="rounded-lg border border-gray-200 bg-white shadow-sm flex flex-col" id="inventory-receiving-queue">
          <div className="flex items-center justify-between px-[18px] py-[15px] border-b border-gray-100">
            <h2 className="flex items-center gap-2.5 text-[15px] font-bold text-gray-900">
              <Truck className="w-[17px] h-[17px] text-primary-600" /> {t('dashboard.receiving.title', 'Receiving queue')}
            </h2>
            <a href="/msp/inventory/purchase-orders" className="text-[12.5px] font-semibold text-primary-600 hover:underline inline-flex items-center gap-1">
              {t('dashboard.receiving.allPos', 'All POs')} <ArrowRight className="w-3.5 h-3.5" />
            </a>
          </div>
          <div className="py-1.5">
            {queue.length === 0 && <div className="px-[18px] py-6 text-center text-sm text-gray-400">{t('dashboard.receiving.empty', 'No open purchase orders.')}</div>}
            {queue.slice(0, 4).map((po: ReceivingPo) => {
              const initials = (po.vendor_name ?? '?')
                .split(/\s+/)
                .slice(0, 2)
                .map((w) => w[0])
                .join('')
                .toUpperCase();
              const tone: keyof typeof PILL =
                po.status === 'partially_received' ? 'warn' : po.eta_label === 'ETA today' ? 'ok' : 'muted';
              const label =
                po.status === 'partially_received'
                  ? t('dashboard.receiving.partial', 'Partial')
                  : po.eta_label === 'ETA today'
                    ? t('dashboard.receiving.arriving', 'Arriving')
                    : t('dashboard.receiving.open', 'Open');
              const unitText =
                po.ordered === 1
                  ? t('dashboard.receiving.unit', '{{count}} unit', { count: po.ordered })
                  : t('dashboard.receiving.units', '{{count}} units', { count: po.ordered });
              return (
                <div key={po.po_id} className="flex items-center gap-2.5 px-[18px] py-2.5 [&+&]:border-t [&+&]:border-gray-100">
                  <Chip tone="cyan" size={34}>
                    <b className="text-[12px] font-bold">{initials}</b>
                  </Chip>
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-semibold text-gray-800 truncate">
                      {po.po_number} · {po.vendor_name ?? t('dashboard.receiving.vendorFallback', 'Vendor')}
                    </div>
                    <div className="text-[12px] text-gray-500">
                      {po.status === 'partially_received'
                        ? t('dashboard.receiving.receivedOf', '{{received}} of {{ordered}} received', { received: po.received, ordered: po.ordered })
                        : `${unitText}${po.eta_label ? ` · ${po.eta_label}` : ''}`}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-[13.5px] font-bold text-gray-900">{money(po.total_value)}</div>
                    <div className="mt-1">
                      <Pill tone={tone}>{label}</Pill>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="border-t border-gray-100 px-[18px] py-3.5 mt-auto">
            <div className="text-[11px] font-bold uppercase tracking-wider text-gray-400 mb-2.5">{t('dashboard.thisWeek.title', 'This week')}</div>
            <div className="grid grid-cols-2 gap-3">
              {[
                [t('dashboard.thisWeek.unitsReceived', 'Units received'), d.this_week.received],
                [t('dashboard.thisWeek.unitsDeployed', 'Units deployed'), d.this_week.deployed],
                [t('dashboard.thisWeek.transfers', 'Transfers between sites'), d.this_week.transfers],
                [t('dashboard.thisWeek.rmasOpened', 'RMAs opened'), d.this_week.rmas_opened],
              ].map(([k, v]) => (
                <div key={k as string}>
                  <div className="text-[21px] font-bold text-gray-900 leading-none">{v as number}</div>
                  <div className="text-[12px] text-gray-500 mt-1">{k as string}</div>
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>

      {/* lower: value by location + recent movements */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-[18px]">
        <section className="rounded-lg border border-gray-200 bg-white shadow-sm" id="inventory-value-by-location">
          <div className="flex items-center justify-between px-[18px] py-[15px] border-b border-gray-100">
            <h2 className="text-[15px] font-bold text-gray-900">{t('dashboard.valueByLocation.title', 'Inventory value by location')}</h2>
            <span className="text-[12.5px] text-gray-500">{t('dashboard.valueByLocation.grandTotal', 'Grand total {{total}}', { total: money(iv.grand_total) })}</span>
          </div>
          <div className="px-[18px] py-2 pb-4">
            {iv.by_location.length === 0 && <div className="py-6 text-center text-sm text-gray-400">{t('dashboard.valueByLocation.empty', 'No stock on hand.')}</div>}
            {iv.by_location.slice(0, 6).map((loc) => {
              const pct = iv.grand_total > 0 ? Math.round((loc.total_value / iv.grand_total) * 100) : 0;
              const isVan = loc.location_type === 'van';
              return (
                <div key={loc.location_id} className="py-[11px] border-b border-gray-100 last:border-b-0">
                  <div className="flex items-center justify-between mb-[7px]">
                    <span className="flex items-center gap-2 text-[13px] font-semibold text-gray-700">
                      {isVan ? <Truck className="w-3.5 h-3.5 text-gray-400" /> : <MapPin className="w-3.5 h-3.5 text-primary-600" />}
                      {loc.location_name}
                    </span>
                    <span className="text-[13px] font-bold text-gray-900">
                      {money(loc.total_value)} · {pct}%
                    </span>
                  </div>
                  <div className="h-2 rounded-md bg-gray-100 overflow-hidden">
                    <div
                      className="h-full rounded-md"
                      style={{
                        width: `${Math.max(pct, 2)}%`,
                        background: isVan
                          ? 'linear-gradient(90deg,#cbd5e1,#94a3b8)'
                          : 'linear-gradient(90deg,#a673f2,#7c45d3)',
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <section className="rounded-lg border border-gray-200 bg-white shadow-sm" id="inventory-recent-movements">
          <div className="flex items-center justify-between px-[18px] py-[15px] border-b border-gray-100">
            <h2 className="text-[15px] font-bold text-gray-900">{t('dashboard.movements.title', 'Recent stock movements')}</h2>
            <a href="/msp/inventory/stock" className="text-[12.5px] font-semibold text-primary-600 hover:underline inline-flex items-center gap-1">
              {t('dashboard.movements.fullLedger', 'Full ledger')} <ArrowRight className="w-3.5 h-3.5" />
            </a>
          </div>
          <div className="py-1">
            {movements.length === 0 && <div className="px-[18px] py-6 text-center text-sm text-gray-400">{t('dashboard.movements.empty', 'No recent movement.')}</div>}
            {movements.map((m) => (
              <MovementLine key={m.movement_id} m={m} />
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
