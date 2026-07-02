'use client';

import React from 'react';
import type {
  ClientPulseService,
  ClientPulseMoney,
  ClientPulseInstallBase,
  ClientPulsePeople,
  ClientPulseLocation,
  ClientPulseDocuments,
  ClientPulseRecord,
} from '../../../lib/commandCenterTypes';

type TFn = (key: string, options?: Record<string, unknown>) => string;

interface CardShellProps {
  id: string;
  title: string;
  action?: { label: string; onClick: () => void } | null;
  className?: string;
  children: React.ReactNode;
}

export function CardShell({ id, title, action, className = '', children }: CardShellProps) {
  return (
    <div id={id} className={`bg-white border border-gray-200 rounded-xl p-4 min-w-0 ${className}`}>
      <div className="flex items-center mb-3">
        <h3 className="text-xs font-bold uppercase tracking-wide text-gray-500">{title}</h3>
        {action && (
          <button
            id={`${id}-open`}
            type="button"
            onClick={action.onClick}
            className="ml-auto text-xs font-semibold text-primary-600 hover:text-primary-800"
          >
            {action.label}
          </button>
        )}
      </div>
      {children}
    </div>
  );
}

function EmptyLine({ text }: { text: string }) {
  return <p className="text-[13px] text-gray-400 italic">{text}</p>;
}

function Stat({ value, label }: { value: React.ReactNode; label: string }) {
  return (
    <div>
      <div className="text-2xl font-bold text-gray-900 leading-tight">{value}</div>
      <div className="text-[11.5px] text-gray-500">{label}</div>
    </div>
  );
}

const timeAgoDays = (iso: string): number =>
  Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000));

// ── Service ──────────────────────────────────────────────────────────────────

export function ServiceCard({ id, data, onOpen, onOpenTicket, onNewTicket, t }: {
  id: string;
  data: ClientPulseService;
  onOpen: (() => void) | null;
  onOpenTicket: (ticketId: string) => void;
  onNewTicket: () => void;
  t: TFn;
}) {
  return (
    <CardShell
      id={id}
      title={t('clientCommandCenter.cards.service', { defaultValue: 'Service' })}
      action={onOpen ? { label: t('clientCommandCenter.openView', { defaultValue: 'Open ↗' }), onClick: onOpen } : null}
    >
      <div className="flex gap-6 mb-3">
        <Stat value={data.openCount} label={t('clientCommandCenter.service.open', { defaultValue: 'open tickets' })} />
        <Stat
          value={data.oldestOpenDays != null ? `${data.oldestOpenDays}d` : '—'}
          label={t('clientCommandCenter.service.oldest', { defaultValue: 'oldest open' })}
        />
        <Stat value={data.overdueCount} label={t('clientCommandCenter.service.overdue', { defaultValue: 'overdue' })} />
      </div>
      {data.topOpen.length === 0 ? (
        <EmptyLine text={t('clientCommandCenter.service.none', { defaultValue: 'No open tickets.' })} />
      ) : (
        <ul className="divide-y divide-gray-100">
          {data.topOpen.map((ticket) => (
            <li key={ticket.ticket_id} className="py-1.5 flex items-baseline gap-2 text-[13px]">
              {ticket.priority_name && (
                <span
                  className="inline-block rounded px-1.5 text-[10.5px] font-bold"
                  style={{
                    color: ticket.priority_color ?? '#374151',
                    backgroundColor: `${ticket.priority_color ?? '#9ca3af'}22`,
                  }}
                >
                  {ticket.priority_name}
                </span>
              )}
              <button
                type="button"
                onClick={() => onOpenTicket(ticket.ticket_id)}
                className="text-primary-700 font-medium hover:underline truncate text-left"
              >
                #{ticket.ticket_number} {ticket.title}
              </button>
              <span className="ml-auto text-[11px] text-gray-400 whitespace-nowrap">
                {ticket.is_overdue
                  ? t('clientCommandCenter.service.overdueTag', { defaultValue: 'overdue' })
                  : `${timeAgoDays(ticket.entered_at)}d`}
              </span>
            </li>
          ))}
        </ul>
      )}
      <button
        id={`${id}-new-ticket`}
        type="button"
        onClick={onNewTicket}
        className="mt-3 text-xs font-semibold text-primary-600 hover:text-primary-800"
      >
        {t('clientCommandCenter.service.newTicket', { defaultValue: '＋ New ticket' })}
      </button>
    </CardShell>
  );
}

// ── Money ────────────────────────────────────────────────────────────────────

export function MoneyCard({ id, data, formatMoney, onOpen, onOpenInvoice, t }: {
  id: string;
  data: ClientPulseMoney;
  formatMoney: (cents: number) => string;
  onOpen: (() => void) | null;
  onOpenInvoice: (invoiceId: string) => void;
  t: TFn;
}) {
  const buckets = [
    { key: 'current', label: t('clientCommandCenter.money.current', { defaultValue: 'current' }), cents: data.aging.currentCents, warn: false },
    { key: 'd30', label: '1–30d', cents: data.aging.d30Cents, warn: false },
    { key: 'd60', label: '31–60d', cents: data.aging.d60Cents, warn: true },
    { key: 'd90', label: '60d+', cents: data.aging.d90PlusCents, warn: true },
  ];
  const maxCents = Math.max(...buckets.map((bucket) => bucket.cents), 1);
  const hasOutstanding = data.outstandingTotalCents > 0;

  return (
    <CardShell
      id={id}
      title={t('clientCommandCenter.cards.money', { defaultValue: 'Money' })}
      action={onOpen ? { label: t('clientCommandCenter.openView', { defaultValue: 'Open ↗' }), onClick: onOpen } : null}
    >
      {hasOutstanding ? (
        <>
          <div className="flex items-end gap-2 h-16 mt-4">
            {buckets.map((bucket) => (
              <div key={bucket.key} className="flex-1 flex flex-col justify-end items-stretch">
                <div className="text-center text-[10px] text-gray-500 mb-0.5">
                  {bucket.cents > 0 ? formatMoney(bucket.cents) : ''}
                </div>
                <div
                  className={`rounded-t ${bucket.warn ? 'bg-amber-200' : 'bg-primary-100'}`}
                  style={{ height: `${Math.max(4, Math.round((bucket.cents / maxCents) * 44))}px` }}
                />
              </div>
            ))}
          </div>
          <div className="flex gap-2 mb-1">
            {buckets.map((bucket) => (
              <div key={bucket.key} className="flex-1 text-center text-[9.5px] text-gray-400">{bucket.label}</div>
            ))}
          </div>
          <p className="text-[11px] text-gray-400 mb-2">
            {t('clientCommandCenter.money.agingNote', {
              defaultValue: '{{total}} outstanding · recorded payments deducted',
              total: formatMoney(data.outstandingTotalCents),
            })}
          </p>
        </>
      ) : (
        <p className="text-[13px] text-gray-400 italic mb-2 mt-1">
          {t('clientCommandCenter.money.nothingOutstanding', { defaultValue: 'Nothing outstanding on finalized invoices.' })}
        </p>
      )}
      <ul className="divide-y divide-gray-100 border-t border-gray-100">
        {data.draftInvoices.map((invoice) => (
          <li key={invoice.invoice_id} className="py-1.5 flex items-baseline gap-2 text-[13px]">
            <button
              type="button"
              onClick={() => onOpenInvoice(invoice.invoice_id)}
              className="text-primary-700 font-medium hover:underline"
            >
              {invoice.invoice_number ?? invoice.invoice_id.slice(0, 8)}
            </button>
            <span className="inline-block rounded bg-amber-100 text-amber-800 px-1.5 text-[10.5px] font-bold">
              {t('clientCommandCenter.money.draft', { defaultValue: 'draft' })}
            </span>
            <span className="ml-auto text-gray-500">{formatMoney(invoice.totalCents)}</span>
          </li>
        ))}
        <li className="py-1.5 flex items-baseline text-[13px]">
          <span className="text-gray-600">
            {t('clientCommandCenter.money.activeContracts', { defaultValue: 'Active contracts' })}
          </span>
          <span className="ml-auto font-semibold text-gray-900">{data.activeContractCount}</span>
        </li>
      </ul>
    </CardShell>
  );
}

// ── Install base ─────────────────────────────────────────────────────────────

export function InstallBaseCard({ id, data, onOpen, onOpenAsset, t }: {
  id: string;
  data: ClientPulseInstallBase;
  onOpen: (() => void) | null;
  onOpenAsset: (assetId: string) => void;
  t: TFn;
}) {
  return (
    <CardShell
      id={id}
      title={t('clientCommandCenter.cards.installBase', { defaultValue: 'Install base' })}
      action={onOpen ? { label: t('clientCommandCenter.openView', { defaultValue: 'Open ↗' }), onClick: onOpen } : null}
    >
      <div className="flex gap-6 mb-3">
        {data.managedAssetCount != null && (
          <Stat value={data.managedAssetCount} label={t('clientCommandCenter.installBase.assets', { defaultValue: 'managed assets' })} />
        )}
        <Stat value={data.soldUnitCount} label={t('clientCommandCenter.installBase.sold', { defaultValue: 'sold units' })} />
        <Stat value={data.openRmaCount} label={t('clientCommandCenter.installBase.rmas', { defaultValue: 'open RMAs' })} />
      </div>
      {data.recentUnits.length === 0 ? (
        <EmptyLine text={t('clientCommandCenter.installBase.none', { defaultValue: 'No delivered equipment yet.' })} />
      ) : (
        <ul className="divide-y divide-gray-100">
          {data.recentUnits.map((unit) => (
            <li key={unit.unit_id} className="py-1.5 flex items-baseline gap-2 text-[13px]">
              <span className="text-gray-800 truncate">
                {unit.product_name}
                {unit.serial_number ? <span className="text-gray-400"> · {unit.serial_number}</span> : null}
              </span>
              {unit.asset_id && (
                <button
                  type="button"
                  onClick={() => onOpenAsset(unit.asset_id!)}
                  className="text-primary-700 text-[11.5px] font-semibold hover:underline whitespace-nowrap"
                >
                  {t('clientCommandCenter.installBase.viewAsset', { defaultValue: 'asset ↗' })}
                </button>
              )}
              <span className="ml-auto text-[11px] text-gray-400 whitespace-nowrap">
                {unit.delivered_at ? `${timeAgoDays(unit.delivered_at)}d` : unit.status}
              </span>
            </li>
          ))}
        </ul>
      )}
    </CardShell>
  );
}

// ── People ───────────────────────────────────────────────────────────────────

export function PeopleCard({ id, data, onOpen, t }: {
  id: string;
  data: ClientPulsePeople;
  onOpen: (() => void) | null;
  t: TFn;
}) {
  return (
    <CardShell
      id={id}
      title={t('clientCommandCenter.cards.people', { defaultValue: 'People' })}
      action={onOpen ? { label: t('clientCommandCenter.openView', { defaultValue: 'Open ↗' }), onClick: onOpen } : null}
    >
      {data.top.length === 0 ? (
        <EmptyLine text={t('clientCommandCenter.people.none', { defaultValue: 'No contacts yet.' })} />
      ) : (
        <ul className="divide-y divide-gray-100">
          {data.top.map((contact) => (
            <li key={contact.contact_name_id} className="py-2 flex items-center gap-2.5 text-[13px]">
              <span className="w-7 h-7 rounded-full bg-primary-50 text-primary-700 flex items-center justify-center text-[10.5px] font-bold shrink-0">
                {contact.full_name.split(/\s+/).map((part) => part[0]).slice(0, 2).join('').toUpperCase()}
              </span>
              <span className="min-w-0">
                <span className="block font-semibold text-gray-900 truncate">{contact.full_name}</span>
                <span className="block text-[11px] text-gray-500 truncate">
                  {[contact.is_default ? t('clientCommandCenter.people.primary', { defaultValue: 'Primary' }) : null, contact.role]
                    .filter(Boolean).join(' · ') || contact.email || ''}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
      {data.totalCount > data.top.length && (
        <p className="mt-1.5 text-[11px] text-gray-400">
          {t('clientCommandCenter.people.more', { defaultValue: '+{{count}} more', count: data.totalCount - data.top.length })}
        </p>
      )}
    </CardShell>
  );
}

// ── Locations ────────────────────────────────────────────────────────────────

export function LocationsCard({ id, locations, onManage, t }: {
  id: string;
  locations: ClientPulseLocation[];
  onManage: (() => void) | null;
  t: TFn;
}) {
  return (
    <CardShell
      id={id}
      title={t('clientCommandCenter.cards.locations', { defaultValue: 'Locations' })}
      action={onManage ? { label: t('clientCommandCenter.locations.manage', { defaultValue: 'Manage ↗' }), onClick: onManage } : null}
    >
      {locations.length === 0 ? (
        <EmptyLine text={t('clientCommandCenter.locations.none', { defaultValue: 'No locations yet.' })} />
      ) : (
        <ul className="divide-y divide-gray-100">
          {locations.slice(0, 3).map((location) => (
            <li key={location.location_id} className="py-2 text-[13px]">
              <div className="font-semibold text-gray-900">
                📍 {location.location_name || location.address_line1}
                {location.is_default ? ' ★' : ''}
              </div>
              <div className="text-[12px] text-gray-500 truncate">
                {[location.address_line1, location.city].filter(Boolean).join(', ')}
              </div>
              <div className="mt-1 flex gap-1">
                {location.is_billing && (
                  <span className="rounded bg-blue-100 text-blue-700 px-1.5 text-[10px] font-bold">
                    {t('clientCommandCenter.locations.billing', { defaultValue: 'Billing' })}
                  </span>
                )}
                {location.is_shipping && (
                  <span className="rounded bg-green-100 text-green-700 px-1.5 text-[10px] font-bold">
                    {t('clientCommandCenter.locations.shipping', { defaultValue: 'Shipping' })}
                  </span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </CardShell>
  );
}

// ── Documents ────────────────────────────────────────────────────────────────

export function DocumentsCard({ id, data, onOpen, t }: {
  id: string;
  data: ClientPulseDocuments;
  onOpen: (() => void) | null;
  t: TFn;
}) {
  return (
    <CardShell
      id={id}
      title={t('clientCommandCenter.cards.documents', { defaultValue: 'Documents' })}
      action={onOpen ? { label: t('clientCommandCenter.openView', { defaultValue: 'Open ↗' }), onClick: onOpen } : null}
    >
      {data.recent.length === 0 ? (
        <EmptyLine text={t('clientCommandCenter.documents.none', { defaultValue: 'No documents yet.' })} />
      ) : (
        <ul className="divide-y divide-gray-100">
          {data.recent.map((doc) => (
            <li key={doc.document_id} className="py-1.5 flex items-baseline gap-2 text-[13px]">
              <span className="text-gray-800 truncate">📄 {doc.document_name}</span>
              <span className="ml-auto text-[11px] text-gray-400 whitespace-nowrap">{timeAgoDays(doc.updated_at)}d</span>
            </li>
          ))}
        </ul>
      )}
      {data.totalCount > data.recent.length && (
        <p className="mt-1.5 text-[11px] text-gray-400">
          {t('clientCommandCenter.documents.more', { defaultValue: '+{{count}} more', count: data.totalCount - data.recent.length })}
        </p>
      )}
    </CardShell>
  );
}

// ── Client record ────────────────────────────────────────────────────────────

export function RecordCard({ id, data, onOpen, t }: {
  id: string;
  data: ClientPulseRecord;
  onOpen: (() => void) | null;
  t: TFn;
}) {
  const rows: Array<{ label: string; value: string | null }> = [
    {
      label: t('clientCommandCenter.record.accountManager', { defaultValue: 'Account manager' }),
      value: data.accountManagerName,
    },
    {
      label: t('clientCommandCenter.record.defaultContact', { defaultValue: 'Default contact' }),
      value: data.defaultContactName,
    },
    {
      label: t('clientCommandCenter.record.inboundDomains', { defaultValue: 'Inbound domains' }),
      value: data.inboundDomains.length ? data.inboundDomains.join(', ') : null,
    },
    {
      label: t('clientCommandCenter.record.taxRegion', { defaultValue: 'Tax region' }),
      value: data.taxRegion,
    },
  ];

  return (
    <CardShell
      id={id}
      title={t('clientCommandCenter.cards.record', { defaultValue: 'Client record' })}
      action={onOpen ? { label: t('clientCommandCenter.record.edit', { defaultValue: 'Edit ↗' }), onClick: onOpen } : null}
    >
      <ul className="divide-y divide-gray-100">
        {rows.map((row) => (
          <li key={row.label} className="py-1.5 flex items-baseline gap-3 text-[13px]">
            <span className="text-gray-600">{row.label}</span>
            <span className={`ml-auto text-right truncate ${row.value ? 'text-gray-900' : 'text-gray-400 italic'}`}>
              {row.value ?? t('clientCommandCenter.record.unset', { defaultValue: 'not set' })}
            </span>
          </li>
        ))}
      </ul>
    </CardShell>
  );
}
