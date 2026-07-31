'use client';

import React from 'react';
import { ArrowUpRight, FileText, Mail, MapPin, Phone, Plus, Settings } from 'lucide-react';
import ContactAvatar from '@alga-psa/ui/components/ContactAvatar';
import {
  BentoChip,
  BentoFooterLinks,
  BentoRow,
  BentoRowList,
  BentoRowMeta,
  BentoStat,
  BentoTile,
  BentoTileEmpty,
  type BentoFooterLink,
} from '@alga-psa/ui/components/bento';
import type {
  ClientPulseService,
  ClientPulseMoney,
  ClientPulseInstallBase,
  ClientPulseNotes,
  ClientPulsePeople,
  ClientPulseLocation,
  ClientPulseDocuments,
  ClientPulseRecord,
  ClientPulseTicketSla,
} from '../../../lib/commandCenterTypes';

type TFn = (key: string, options?: Record<string, unknown>) => string;

export type CardFooterLink = BentoFooterLink;

interface CardShellProps {
  id: string;
  title: string;
  action?: { label: string; onClick: () => void; icon?: React.ReactNode } | null;
  /** Contextual entry links to related focus views (only live links render). */
  footerLinks?: Array<CardFooterLink | null>;
  className?: string;
  children: React.ReactNode;
}

export function CardShell({ id, title, action, footerLinks, className = '', children }: CardShellProps) {
  return (
    <BentoTile
      id={id}
      title={title}
      className={className}
      action={action ? (
        <button
          id={`${id}-open`}
          type="button"
          onClick={action.onClick}
          className="inline-flex items-center gap-0.5 text-xs font-semibold text-primary-600 hover:text-primary-800 whitespace-nowrap"
        >
          {action.label}
          {action.icon ?? <ArrowUpRight className="w-3 h-3" aria-hidden="true" />}
        </button>
      ) : undefined}
    >
      {children}
      <BentoFooterLinks idPrefix={id} links={footerLinks ?? []} />
    </BentoTile>
  );
}

const CONTACT_ICON_CLASS = 'inline w-3 h-3 -mt-0.5 mr-1';

const timeAgoDays = (iso: string): number =>
  Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000));

/** "45m" / "3h 20m" / "2d" — for SLA countdowns. */
const formatMinutes = (minutes: number): string => {
  const abs = Math.abs(Math.round(minutes));
  if (abs < 60) return `${abs}m`;
  if (abs < 48 * 60) {
    const hours = Math.floor(abs / 60);
    const rest = abs % 60;
    return rest ? `${hours}h ${rest}m` : `${hours}h`;
  }
  return `${Math.floor(abs / (24 * 60))}d`;
};

/**
 * Per-ticket SLA state from tickets.sla_* columns — never a due_date proxy.
 * The with-time and without-time phrasings are separate keys: a single key
 * with a conditional defaultValue can't survive extraction, because the
 * translated string would keep the {{over}} slot even with nothing to put in it.
 */
function SlaChip({ sla, t }: { sla: ClientPulseTicketSla; t: TFn }) {
  const remaining = sla.remainingMinutes != null ? formatMinutes(sla.remainingMinutes) : null;
  switch (sla.status) {
    case 'response_breached':
    case 'resolution_breached':
      return (
        <BentoChip tone="danger">
          {remaining
            ? t('clientCommandCenter.sla.breachedAgo', { defaultValue: 'SLA breached {{over}} ago', over: remaining })
            : t('clientCommandCenter.sla.breached', { defaultValue: 'SLA breached' })}
        </BentoChip>
      );
    case 'at_risk':
      return (
        <BentoChip tone="warning">
          {remaining
            ? t('clientCommandCenter.sla.atRiskLeft', { defaultValue: 'SLA {{left}} left', left: remaining })
            : t('clientCommandCenter.sla.atRisk', { defaultValue: 'SLA at risk' })}
        </BentoChip>
      );
    case 'paused':
      return (
        <BentoChip tone="neutral">
          {t('clientCommandCenter.sla.paused', { defaultValue: 'SLA paused' })}
        </BentoChip>
      );
    default:
      return (
        <span className="text-[10px] text-[rgb(var(--color-text-400))] whitespace-nowrap">
          {remaining
            ? t('clientCommandCenter.sla.onTrackLeft', { defaultValue: 'SLA {{left}} left', left: remaining })
            : t('clientCommandCenter.sla.onTrack', { defaultValue: 'SLA on track' })}
        </span>
      );
  }
}

// ── Service ──────────────────────────────────────────────────────────────────

export function ServiceCard({ id, data, onOpen, onOpenTicket, onNewTicket, className, t }: {
  id: string;
  data: ClientPulseService;
  onOpen: (() => void) | null;
  onOpenTicket: (ticketId: string) => void;
  onNewTicket: () => void;
  className?: string;
  t: TFn;
}) {
  return (
    <CardShell
      id={id}
      title={t('clientCommandCenter.cards.service', { defaultValue: 'Service' })}
      action={onOpen ? { label: t('clientCommandCenter.openView', { defaultValue: 'Open' }), onClick: onOpen } : null}
      className={className}
    >
      <div className="flex gap-6 mb-3">
        <BentoStat value={data.openCount} label={t('clientCommandCenter.service.open', { defaultValue: 'open tickets' })} />
        <BentoStat
          value={data.oldestOpenDays != null ? `${data.oldestOpenDays}d` : '—'}
          label={t('clientCommandCenter.service.oldest', { defaultValue: 'oldest open' })}
        />
        <BentoStat value={data.overdueCount} label={t('clientCommandCenter.service.overdue', { defaultValue: 'overdue' })} />
      </div>
      {data.topOpen.length === 0 ? (
        <BentoTileEmpty id={`${id}-empty`}>
          {t('clientCommandCenter.service.none', { defaultValue: 'No open tickets.' })}
        </BentoTileEmpty>
      ) : (
        <BentoRowList>
          {data.topOpen.map((ticket) => (
            <BentoRow key={ticket.ticket_id} stacked>
              <div className="flex items-baseline gap-2">
                {ticket.priority_name && (
                  <BentoChip
                    style={{
                      color: ticket.priority_color ?? '#374151',
                      backgroundColor: `${ticket.priority_color ?? '#9ca3af'}22`,
                    }}
                  >
                    {ticket.priority_name}
                  </BentoChip>
                )}
                <button
                  type="button"
                  onClick={() => onOpenTicket(ticket.ticket_id)}
                  className="text-primary-700 font-medium hover:underline truncate text-left"
                >
                  #{ticket.ticket_number} {ticket.title}
                </button>
                <BentoRowMeta>
                  {ticket.is_overdue
                    ? t('clientCommandCenter.service.overdueTag', { defaultValue: 'overdue' })
                    : `${timeAgoDays(ticket.entered_at)}d`}
                </BentoRowMeta>
              </div>
              {/* Ownership + SLA (W1/W3) — rendered only when the pulse carries them. */}
              {(ticket.assigned_to_name !== undefined || ticket.sla) && (
                <div className="mt-0.5 flex items-center gap-2 text-xs">
                  {ticket.assigned_to_name !== undefined && (
                    ticket.assigned_to_name ? (
                      <span className="text-[rgb(var(--color-text-500))] truncate">{ticket.assigned_to_name}</span>
                    ) : (
                      <span className="text-[rgb(var(--color-text-400))] italic">
                        {t('clientCommandCenter.service.unassigned', { defaultValue: 'Unassigned' })}
                      </span>
                    )
                  )}
                  {ticket.sla && <SlaChip sla={ticket.sla} t={t} />}
                </div>
              )}
            </BentoRow>
          ))}
        </BentoRowList>
      )}
      <button
        id={`${id}-new-ticket`}
        type="button"
        onClick={onNewTicket}
        className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-primary-600 hover:text-primary-800"
      >
        <Plus className="w-3 h-3" aria-hidden="true" />
        {t('clientCommandCenter.service.newTicket', { defaultValue: 'New ticket' })}
      </button>
    </CardShell>
  );
}

// ── Money ────────────────────────────────────────────────────────────────────

export function MoneyCard({ id, data, formatMoney, onOpen, onOpenInvoice, onOpenBillingSetup, onOpenTaxSettings, className, t }: {
  id: string;
  data: ClientPulseMoney;
  formatMoney: (cents: number) => string;
  onOpen: (() => void) | null;
  onOpenInvoice: (invoiceId: string) => void;
  onOpenBillingSetup: (() => void) | null;
  onOpenTaxSettings: (() => void) | null;
  className?: string;
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
      action={onOpen ? { label: t('clientCommandCenter.openView', { defaultValue: 'Open' }), onClick: onOpen } : null}
      className={className}
      footerLinks={[
        onOpenBillingSetup
          ? {
            id: 'billing-setup',
            label: t('clientCommandCenter.money.billingSetup', { defaultValue: 'Billing setup' }),
            icon: <Settings className="w-3 h-3" aria-hidden="true" />,
            onClick: onOpenBillingSetup,
          }
          : null,
        onOpenTaxSettings
          ? { id: 'tax-settings', label: t('clientCommandCenter.money.taxSettings', { defaultValue: 'Tax settings' }), onClick: onOpenTaxSettings }
          : null,
      ]}
    >
      {hasOutstanding ? (
        <>
          <div className="flex items-end gap-2 h-16 mt-4 border-b border-[rgb(var(--color-border-200))]">
            {buckets.map((bucket) => (
              <div
                key={bucket.key}
                className="flex-1 flex flex-col justify-end items-stretch"
                title={`${bucket.label}: ${formatMoney(bucket.cents)}`}
              >
                <div className="text-center text-[10px] text-[rgb(var(--color-text-500))] mb-0.5">
                  {bucket.cents > 0 ? formatMoney(bucket.cents) : ''}
                </div>
                {/* A bucket with $0 renders no bar at all — a visibility floor on
                    zero would fake data the honesty rules forbid (D6). */}
                {bucket.cents > 0 && (
                  <div
                    className={`rounded-t ${bucket.warn ? 'bg-amber-200 dark:bg-amber-500/40' : 'bg-primary-100'}`}
                    style={{ height: `${Math.max(4, Math.round((bucket.cents / maxCents) * 44))}px` }}
                  />
                )}
              </div>
            ))}
          </div>
          <div className="flex gap-2 mb-1">
            {buckets.map((bucket) => (
              <div key={bucket.key} className="flex-1 text-center text-[10px] text-[rgb(var(--color-text-400))]">{bucket.label}</div>
            ))}
          </div>
          <p className="text-xs text-[rgb(var(--color-text-400))] mb-2">
            {t('clientCommandCenter.money.agingNote', {
              defaultValue: '{{total}} outstanding · recorded payments deducted',
              total: formatMoney(data.outstandingTotalCents),
            })}
          </p>
        </>
      ) : (
        <BentoTileEmpty id={`${id}-empty`}>
          {t('clientCommandCenter.money.nothingOutstanding', { defaultValue: 'Nothing outstanding on finalized invoices.' })}
        </BentoTileEmpty>
      )}
      <BentoRowList className="mt-1 border-t border-[rgb(var(--color-border-100))] pt-1.5">
        {data.draftInvoices.map((invoice) => (
          <BentoRow key={invoice.invoice_id} meta={formatMoney(invoice.totalCents)}>
            <button
              type="button"
              onClick={() => onOpenInvoice(invoice.invoice_id)}
              className="text-primary-700 font-medium hover:underline"
            >
              {invoice.invoice_number ?? invoice.invoice_id.slice(0, 8)}
            </button>
            <BentoChip tone="warning">
              {t('clientCommandCenter.money.draft', { defaultValue: 'draft' })}
            </BentoChip>
          </BentoRow>
        ))}
        {data.draftInvoiceCount > data.draftInvoices.length && (
          <BentoRow id={`${id}-more-drafts`}>
            <span className="text-xs text-[rgb(var(--color-text-400))]">
              {t('clientCommandCenter.money.moreDrafts', {
                defaultValue_one: '+1 more draft',
                defaultValue_other: '+{{count}} more drafts',
                count: data.draftInvoiceCount - data.draftInvoices.length,
              })}
            </span>
          </BentoRow>
        )}
        {/* W2: time in hours (time entries carry no rate — no invented dollars);
            materials in exact cents. Rendered only when something is unbilled. */}
        {data.wip && (data.wip.unbilledEntryCount > 0 || data.wip.unbilledMaterialCount > 0) && (
          <BentoRow>
            <span className="text-[rgb(var(--color-text-600))]">
              {t('clientCommandCenter.money.unbilledWork', { defaultValue: 'Unbilled work' })}
            </span>
            <span className="ml-auto font-semibold text-[rgb(var(--color-text-900))] whitespace-nowrap">
              {[
                data.wip.unbilledEntryCount > 0
                  ? t('clientCommandCenter.money.unbilledHours', {
                    defaultValue: '{{hours}}h',
                    hours: data.wip.unbilledHours,
                  })
                  : null,
                data.wip.unbilledMaterialCount > 0
                  ? t('clientCommandCenter.money.unbilledMaterials', {
                    defaultValue: '{{amount}} materials',
                    amount: formatMoney(data.wip.unbilledMaterialsCents),
                  })
                  : null,
              ].filter(Boolean).join(' · ')}
            </span>
          </BentoRow>
        )}
        <BentoRow>
          <span className="text-[rgb(var(--color-text-600))]">
            {t('clientCommandCenter.money.activeContracts', { defaultValue: 'Active contracts' })}
          </span>
          <span className="ml-auto font-semibold text-[rgb(var(--color-text-900))]">{data.activeContractCount}</span>
        </BentoRow>
      </BentoRowList>
    </CardShell>
  );
}

// ── Install base ─────────────────────────────────────────────────────────────

export function InstallBaseCard({ id, data, onOpen, onOpenAssetList, onOpenAsset, className, t }: {
  id: string;
  data: ClientPulseInstallBase;
  onOpen: (() => void) | null;
  /** Assets focus view, when Equipment holds the header action (both tabs exist). */
  onOpenAssetList: (() => void) | null;
  onOpenAsset: (assetId: string) => void;
  className?: string;
  t: TFn;
}) {
  return (
    <CardShell
      id={id}
      title={t('clientCommandCenter.cards.installBase', { defaultValue: 'Install base' })}
      action={onOpen ? { label: t('clientCommandCenter.openView', { defaultValue: 'Open' }), onClick: onOpen } : null}
      className={className}
      footerLinks={[
        onOpenAssetList
          ? {
            id: 'assets',
            label: t('clientCommandCenter.installBase.assetsLink', { defaultValue: 'Managed assets' }),
            icon: <ArrowUpRight className="w-3 h-3" aria-hidden="true" />,
            onClick: onOpenAssetList,
          }
          : null,
      ]}
    >
      <div className="flex gap-6 mb-3">
        {data.managedAssetCount != null && (
          <BentoStat value={data.managedAssetCount} label={t('clientCommandCenter.installBase.assets', { defaultValue: 'managed assets' })} />
        )}
        <BentoStat value={data.soldUnitCount} label={t('clientCommandCenter.installBase.sold', { defaultValue: 'sold units' })} />
        <BentoStat value={data.openRmaCount} label={t('clientCommandCenter.installBase.rmas', { defaultValue: 'open RMAs' })} />
      </div>
      {/* W4: renders only when at least one unit/asset carries a warranty date —
          a fleet that doesn't track warranties shows nothing, not zeros. */}
      {data.warranty && (
        <button
          id={`${id}-warranty`}
          type="button"
          onClick={onOpen ?? undefined}
          disabled={!onOpen}
          className="mb-2 text-xs text-left text-[rgb(var(--color-text-600))] hover:text-primary-700 disabled:hover:text-[rgb(var(--color-text-600))]"
        >
          <span className={data.warranty.expiredCount > 0 ? 'text-red-600 dark:text-red-400 font-semibold' : ''}>
            {t('clientCommandCenter.installBase.warrantyExpired', {
              defaultValue_one: '1 out of warranty',
              defaultValue_other: '{{count}} out of warranty',
              count: data.warranty.expiredCount,
            })}
          </span>
          <span className="text-[rgb(var(--color-text-300))]"> · </span>
          <span className={data.warranty.expiringSoonCount > 0 ? 'text-amber-700 dark:text-amber-400 font-semibold' : ''}>
            {t('clientCommandCenter.installBase.warrantyExpiring', {
              defaultValue_one: '1 expiring ≤90d',
              defaultValue_other: '{{count}} expiring ≤90d',
              count: data.warranty.expiringSoonCount,
            })}
          </span>
          <span className="text-[rgb(var(--color-text-400))]">
            {t('clientCommandCenter.installBase.warrantyTracked', {
              defaultValue: ' (of {{count}} tracked)',
              count: data.warranty.trackedCount,
            })}
          </span>
        </button>
      )}
      {data.recentUnits.length === 0 ? (
        <BentoTileEmpty id={`${id}-empty`}>
          {t('clientCommandCenter.installBase.none', { defaultValue: 'No delivered equipment yet.' })}
        </BentoTileEmpty>
      ) : (
        <BentoRowList>
          {data.recentUnits.map((unit) => (
            <BentoRow
              key={unit.unit_id}
              meta={unit.delivered_at ? `${timeAgoDays(unit.delivered_at)}d` : unit.status}
            >
              <span className="text-[rgb(var(--color-text-800))] truncate">
                {unit.product_name}
                {unit.serial_number ? <span className="text-[rgb(var(--color-text-400))]"> · {unit.serial_number}</span> : null}
              </span>
              {unit.asset_id && (
                <button
                  type="button"
                  onClick={() => onOpenAsset(unit.asset_id!)}
                  className="inline-flex items-center gap-0.5 text-primary-700 text-xs font-semibold hover:underline whitespace-nowrap"
                >
                  {t('clientCommandCenter.installBase.viewAsset', { defaultValue: 'asset' })}
                  <ArrowUpRight className="w-3 h-3" aria-hidden="true" />
                </button>
              )}
            </BentoRow>
          ))}
        </BentoRowList>
      )}
    </CardShell>
  );
}

// ── People ───────────────────────────────────────────────────────────────────

export function PeopleCard({ id, data, onOpen, onOpenContact, onAddContact, className, t }: {
  id: string;
  data: ClientPulsePeople;
  onOpen: (() => void) | null;
  /** Open one contact's quick view directly (drawer), skipping the contacts list. */
  onOpenContact?: ((contactId: string) => void) | null;
  onAddContact?: (() => void) | null;
  className?: string;
  t: TFn;
}) {
  return (
    <CardShell
      id={id}
      title={t('clientCommandCenter.cards.people', { defaultValue: 'People' })}
      action={onOpen ? { label: t('clientCommandCenter.openView', { defaultValue: 'Open' }), onClick: onOpen } : null}
      className={className}
    >
      {data.top.length === 0 ? (
        <BentoTileEmpty id={`${id}-empty`}>
          {t('clientCommandCenter.people.none', { defaultValue: 'No contacts yet.' })}
        </BentoTileEmpty>
      ) : (
        <BentoRowList>
          {data.top.map((contact) => (
            <BentoRow key={contact.contact_name_id} align="center" className="gap-2.5 py-2">
              <ContactAvatar
                contactId={contact.contact_name_id}
                contactName={contact.full_name}
                avatarUrl={contact.avatarUrl}
                size="sm"
                className="shrink-0"
              />
              <span className="min-w-0 flex-1">
                {(() => {
                  const nameLine = (
                    <>
                      {contact.full_name}
                      {(contact.is_default || contact.role) && (
                        <span className="ml-1.5 font-normal text-xs text-[rgb(var(--color-text-400))]">
                          {[contact.is_default ? t('clientCommandCenter.people.primary', { defaultValue: 'Primary' }) : null, contact.role]
                            .filter(Boolean).join(' · ')}
                        </span>
                      )}
                    </>
                  );
                  return onOpenContact ? (
                    <button
                      type="button"
                      onClick={() => onOpenContact(contact.contact_name_id)}
                      className="block w-full text-left font-semibold text-[rgb(var(--color-text-900))] truncate hover:text-primary-700 hover:underline"
                    >
                      {nameLine}
                    </button>
                  ) : (
                    <span className="block font-semibold text-[rgb(var(--color-text-900))] truncate">{nameLine}</span>
                  );
                })()}
                <span className="block text-xs text-[rgb(var(--color-text-600))] truncate">
                  {contact.phone && (
                    <a href={`tel:${contact.phone}`} className="hover:text-primary-700 hover:underline">
                      <Phone className={CONTACT_ICON_CLASS} aria-hidden="true" />{contact.phone}
                    </a>
                  )}
                  {contact.phone && contact.email && <span className="text-[rgb(var(--color-text-300))]"> · </span>}
                  {contact.email && (
                    <a href={`mailto:${contact.email}`} className="hover:text-primary-700 hover:underline">
                      <Mail className={CONTACT_ICON_CLASS} aria-hidden="true" />{contact.email}
                    </a>
                  )}
                  {!contact.phone && !contact.email && (
                    <span className="text-[rgb(var(--color-text-400))] italic">
                      {t('clientCommandCenter.people.noContactInfo', { defaultValue: 'no contact info on file' })}
                    </span>
                  )}
                </span>
              </span>
            </BentoRow>
          ))}
        </BentoRowList>
      )}
      {data.totalCount > data.top.length && (
        <p id={`${id}-more`} className="mt-1.5 text-xs text-[rgb(var(--color-text-400))]">
          {t('clientCommandCenter.people.more', { defaultValue: '+{{count}} more', count: data.totalCount - data.top.length })}
        </p>
      )}
      {onAddContact && (
        <button
          id={`${id}-add-contact`}
          type="button"
          onClick={onAddContact}
          className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-primary-600 hover:text-primary-800 text-left"
        >
          <Plus className="w-3 h-3" aria-hidden="true" />
          {t('clientCommandCenter.people.addContact', { defaultValue: 'Add contact' })}
        </button>
      )}
    </CardShell>
  );
}

// ── Locations ────────────────────────────────────────────────────────────────

export function LocationsCard({ id, locations, onManage, className, t }: {
  id: string;
  locations: ClientPulseLocation[];
  onManage: (() => void) | null;
  className?: string;
  t: TFn;
}) {
  return (
    <CardShell
      id={id}
      title={t('clientCommandCenter.cards.locations', { defaultValue: 'Locations' })}
      action={onManage ? { label: t('clientCommandCenter.locations.manage', { defaultValue: 'Manage' }), onClick: onManage } : null}
      className={className}
    >
      {locations.length === 0 ? (
        <BentoTileEmpty id={`${id}-empty`}>
          {t('clientCommandCenter.locations.none', { defaultValue: 'No locations yet.' })}
        </BentoTileEmpty>
      ) : (
        <BentoRowList>
          {locations.slice(0, 3).map((location) => (
            <BentoRow key={location.location_id} stacked className="py-2">
              <div className="font-semibold text-[rgb(var(--color-text-900))] flex items-center gap-1.5">
                <MapPin className="w-3.5 h-3.5 text-[rgb(var(--color-text-500))] shrink-0" aria-hidden="true" />
                <span className="truncate">
                  {location.location_name || location.address_line1}
                  {location.is_default ? ' ★' : ''}
                </span>
              </div>
              <div className="text-xs text-[rgb(var(--color-text-500))] truncate">
                {[location.address_line1, location.city].filter(Boolean).join(', ')}
              </div>
              {(location.phone || location.email) && (
                <div className="text-xs text-[rgb(var(--color-text-600))] truncate">
                  {location.phone && (
                    <a href={`tel:${location.phone}`} className="hover:text-primary-700 hover:underline">
                      <Phone className={CONTACT_ICON_CLASS} aria-hidden="true" />{location.phone}
                    </a>
                  )}
                  {location.phone && location.email && <span className="text-[rgb(var(--color-text-300))]"> · </span>}
                  {location.email && (
                    <a href={`mailto:${location.email}`} className="hover:text-primary-700 hover:underline">
                      <Mail className={CONTACT_ICON_CLASS} aria-hidden="true" />{location.email}
                    </a>
                  )}
                </div>
              )}
              <div className="mt-1 flex gap-1">
                {location.is_billing && (
                  <BentoChip tone="info">
                    {t('clientCommandCenter.locations.billing', { defaultValue: 'Billing' })}
                  </BentoChip>
                )}
                {location.is_shipping && (
                  <BentoChip tone="success">
                    {t('clientCommandCenter.locations.shipping', { defaultValue: 'Shipping' })}
                  </BentoChip>
                )}
              </div>
            </BentoRow>
          ))}
        </BentoRowList>
      )}
      {locations.length > 3 && (
        <p id={`${id}-more`} className="mt-1.5 text-xs text-[rgb(var(--color-text-400))]">
          {t('clientCommandCenter.locations.more', { defaultValue: '+{{count}} more', count: locations.length - 3 })}
        </p>
      )}
    </CardShell>
  );
}

// ── Documents ────────────────────────────────────────────────────────────────

export function DocumentsCard({ id, data, onOpen, className, t }: {
  id: string;
  data: ClientPulseDocuments;
  onOpen: (() => void) | null;
  className?: string;
  t: TFn;
}) {
  return (
    <CardShell
      id={id}
      title={t('clientCommandCenter.cards.documents', { defaultValue: 'Documents' })}
      action={onOpen ? { label: t('clientCommandCenter.openView', { defaultValue: 'Open' }), onClick: onOpen } : null}
      className={className}
    >
      {data.recent.length === 0 ? (
        <BentoTileEmpty id={`${id}-empty`}>
          {t('clientCommandCenter.documents.none', { defaultValue: 'No documents yet.' })}
        </BentoTileEmpty>
      ) : (
        <BentoRowList>
          {data.recent.map((doc) => (
            <BentoRow key={doc.document_id} meta={`${timeAgoDays(doc.updated_at)}d`}>
              <FileText className="w-3.5 h-3.5 shrink-0 text-[rgb(var(--color-text-400))]" aria-hidden="true" />
              <span className="text-[rgb(var(--color-text-800))] truncate">{doc.document_name}</span>
            </BentoRow>
          ))}
        </BentoRowList>
      )}
      {data.totalCount > data.recent.length && (
        <p id={`${id}-more`} className="mt-1.5 text-xs text-[rgb(var(--color-text-400))]">
          {t('clientCommandCenter.documents.more', { defaultValue: '+{{count}} more', count: data.totalCount - data.recent.length })}
        </p>
      )}
    </CardShell>
  );
}

// ── Notes ────────────────────────────────────────────────────────────────────

export function NotesCard({ id, data, onOpen, className, t }: {
  id: string;
  data: ClientPulseNotes;
  onOpen: (() => void) | null;
  className?: string;
  t: TFn;
}) {
  return (
    <CardShell
      id={id}
      className={className}
      title={t('clientCommandCenter.cards.notes', { defaultValue: 'Notes' })}
      action={onOpen
        ? {
          label: data.hasNotes
            ? t('clientCommandCenter.openView', { defaultValue: 'Open' })
            : t('clientCommandCenter.notes.add', { defaultValue: 'Add note' }),
          icon: data.hasNotes ? undefined : <Plus className="w-3 h-3" aria-hidden="true" />,
          onClick: onOpen,
        }
        : null}
    >
      {!data.hasNotes ? (
        <BentoTileEmpty id={`${id}-empty`}>
          {t('clientCommandCenter.notes.none', { defaultValue: 'No notes yet.' })}
        </BentoTileEmpty>
      ) : (
        <>
          <div className="rounded-lg border border-amber-100 dark:border-amber-900/50 bg-amber-50/50 dark:bg-amber-900/20 px-3 py-2 text-sm text-[rgb(var(--color-text-700))]">
            {data.previewLines.map((line, index) => (
              <p key={index} className={`truncate ${index > 0 ? 'mt-1' : ''}`}>{line}</p>
            ))}
          </div>
          {data.lastEditedAt && (
            <p className="mt-2 text-xs text-[rgb(var(--color-text-400))]">
              {t('clientCommandCenter.notes.lastEdited', {
                defaultValue: 'Shared client note · edited {{days}}d ago',
                days: timeAgoDays(data.lastEditedAt),
              })}
            </p>
          )}
        </>
      )}
    </CardShell>
  );
}

// ── Client record ────────────────────────────────────────────────────────────

export function RecordCard({ id, data, onOpen, onOpenAdditionalInfo, className, t }: {
  id: string;
  data: ClientPulseRecord;
  onOpen: (() => void) | null;
  onOpenAdditionalInfo: (() => void) | null;
  className?: string;
  t: TFn;
}) {
  // W5: tax region + inbound domains were plumbing on the overview (they live
  // in the Details/Tax focus views); the card keeps the who-owns-this facts.
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
      label: t('clientCommandCenter.record.clientSince', { defaultValue: 'Client since' }),
      value: data.clientSince ? new Date(data.clientSince).getFullYear().toString() : null,
    },
  ];

  return (
    <CardShell
      id={id}
      title={t('clientCommandCenter.cards.record', { defaultValue: 'Client record' })}
      action={onOpen ? { label: t('clientCommandCenter.record.edit', { defaultValue: 'Edit' }), onClick: onOpen } : null}
      className={className}
      footerLinks={[
        onOpenAdditionalInfo
          ? { id: 'additional-info', label: t('clientCommandCenter.record.additionalInfo', { defaultValue: 'Additional info' }), onClick: onOpenAdditionalInfo }
          : null,
      ]}
    >
      <BentoRowList>
        {rows.map((row) => (
          <BentoRow key={row.label} className="gap-3">
            <span className="text-[rgb(var(--color-text-600))]">{row.label}</span>
            <span
              className={`ml-auto text-right truncate ${row.value ? 'text-[rgb(var(--color-text-900))]' : 'text-[rgb(var(--color-text-400))] italic'}`}
            >
              {row.value ?? t('clientCommandCenter.record.unset', { defaultValue: 'not set' })}
            </span>
          </BentoRow>
        ))}
      </BentoRowList>
    </CardShell>
  );
}
