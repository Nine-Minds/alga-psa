'use client';

import React, { useMemo, useState } from 'react';
import useSWR from 'swr';
import {
  ArrowRightLeft,
  Boxes,
  History,
  PackageCheck,
  PackageOpen,
  Truck,
  UserRoundCog,
  Pencil,
  Power,
  ShieldCheck,
  Ticket,
  UserMinus,
  UserPlus,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import {
  BentoTile,
  BentoTileEmpty,
  BentoChip,
  BENTO_TONE_TEXT,
  type BentoTone,
} from '@alga-psa/ui/components/bento';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import type {
  Asset,
  AssetHistory,
  AssetMaintenanceReport,
  AssetTicketSummary,
} from '@alga-psa/types';
import { getAssetHistory, getAssetLinkedTickets, getAssetMaintenanceReport } from '../actions/assetActions';
import { unwrapAssetActionResult } from '../actions/assetActionErrors';
import { calendarDateToLocalDate } from '../lib/calendarDate';
import { describeCustodyHistory } from '../lib/custodyDisplay';

type Lane = 'all' | 'service' | 'changes' | 'maintenance' | 'system';

interface TimelineEvent {
  id: string;
  lane: Exclude<Lane, 'all'>;
  at: string;
  icon: LucideIcon;
  tone: BentoTone;
  title: string;
  detail?: string;
  actor?: string;
}

/** Relative age. `now` is injected so the formatter stays pure and testable. */
export function formatEventAge(iso: string, now: number, locale?: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return '';
  const minutes = Math.floor((now - then) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString(locale);
}

/**
 * Milestones taken from a date column (`purchase_date`) rather than from an
 * instant: the column holds UTC midnight for a calendar day, so feeding it
 * straight to the formatter puts the event on the previous day west of UTC —
 * the timeline read "Purchased May 22" while the Identity tile and the edit
 * form both said May 23. Re-anchoring to local midnight keeps the three in
 * agreement; instants (reboot, patch scan) are left alone.
 */
export function calendarMilestoneAt(value: string | null | undefined): string | undefined {
  return calendarDateToLocalDate(value)?.toISOString();
}

/** "status_change" → "Status change". */
function humanise(value: string): string {
  const spaced = value.replace(/[_-]+/g, ' ').trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function changeSummary(changes: Record<string, unknown> | undefined): string | undefined {
  if (!changes) return undefined;
  const keys = Object.keys(changes);
  if (!keys.length) return undefined;
  if (keys.length <= 3) return keys.map(humanise).join(', ');
  return `${keys.slice(0, 3).map(humanise).join(', ')} +${keys.length - 3}`;
}


type TranslateFn = (key: string, options?: Record<string, unknown>) => string;

/**
 * Wording for the entries `setAssetAssignee` and the group model write
 * (F035 / F078). Pure so it can be asserted without rendering the tile.
 */
export function describeAssetHistoryEntry(
  entry: Pick<AssetHistory, 'change_type' | 'changes'>,
  t: TranslateFn
): { title: string; detail?: string; icon: LucideIcon; tone: BentoTone } | null {
  const changes = (entry.changes ?? {}) as Record<string, unknown>;
  const source = typeof changes.source === 'string' ? changes.source : undefined;
  const contactName = typeof changes.contact_name === 'string' ? changes.contact_name : undefined;
  const note = typeof changes.note === 'string' && changes.note ? changes.note : undefined;
  const groupName = typeof changes.group_name === 'string' ? changes.group_name : undefined;

  // Equipment custody (C4): one sentence per step; names are denormalised into `changes`.
  const custody = describeCustodyHistory(entry, t);
  if (custody) {
    const icon: Record<typeof custody.kind, LucideIcon> = {
      received: PackageOpen,
      moved: ArrowRightLeft,
      handed_off: UserRoundCog,
      shipped: Truck,
      returned: PackageCheck,
      updated: Pencil,
    };
    return { title: custody.title, detail: custody.detail, icon: icon[custody.kind], tone: custody.tone };
  }

  if (entry.change_type === 'assignee_changed') {
    if (!changes.contact_name_id) {
      return {
        title: t('assetTimeline.events.unassigned', { defaultValue: 'Unassigned' }),
        detail: note,
        icon: UserMinus,
        tone: 'neutral',
      };
    }
    const person = contactName ?? t('assetTimeline.events.aContact', { defaultValue: 'a contact' });
    if (source === 'rmm') {
      const provider = typeof changes.provider === 'string' && changes.provider ? changes.provider : null;
      return {
        title: provider
          ? t('assetTimeline.events.autoAssignedFrom', {
              defaultValue: 'Auto-assigned to {{contact}} from {{provider}}',
              contact: person,
              provider,
            })
          : t('assetTimeline.events.autoAssigned', {
              defaultValue: 'Auto-assigned to {{contact}} from the signed-in user',
              contact: person,
            }),
        detail: note,
        icon: UserPlus,
        tone: 'info',
      };
    }
    if (source === 'bundle') {
      return {
        title: t('assetTimeline.events.assignedViaBundle', {
          defaultValue: 'Assigned to {{contact}} via bundle {{group}}',
          contact: person,
          group: note ?? groupName ?? '',
        }),
        icon: UserPlus,
        tone: 'info',
      };
    }
    return {
      title: t('assetTimeline.events.assignedTo', { defaultValue: 'Assigned to {{contact}}', contact: person }),
      detail: note,
      icon: UserPlus,
      tone: 'good',
    };
  }

  if (entry.change_type === 'group_added') {
    return {
      title: t('assetTimeline.events.groupAdded', {
        defaultValue: 'Added to {{group}}',
        group: groupName ?? t('assetTimeline.events.aGroup', { defaultValue: 'a group' }),
      }),
      icon: Boxes,
      tone: 'info',
    };
  }

  if (entry.change_type === 'group_location_changed') {
    const locationName = typeof changes.location_name === 'string' && changes.location_name
      ? changes.location_name
      : null;
    return {
      title: locationName
        ? t('assetTimeline.events.groupLocationMoved', {
            defaultValue: 'Moved to {{location}} with {{group}}',
            location: locationName,
            group: groupName ?? t('assetTimeline.events.aGroup', { defaultValue: 'a group' }),
          })
        : t('assetTimeline.events.groupLocationCleared', {
            defaultValue: 'Location cleared with {{group}}',
            group: groupName ?? t('assetTimeline.events.aGroup', { defaultValue: 'a group' }),
          }),
      icon: Boxes,
      tone: 'info',
    };
  }

  if (entry.change_type === 'group_removed') {
    return {
      title: t('assetTimeline.events.groupRemoved', {
        defaultValue: 'Removed from {{group}}',
        group: groupName ?? t('assetTimeline.events.aGroup', { defaultValue: 'a group' }),
      }),
      icon: Boxes,
      tone: 'neutral',
    };
  }

  return null;
}

/**
 * One chronological spine for an asset, in place of a separate Audit Log tab
 * and a "Recent lifecycle events" card.
 *
 * The reason those two surfaces were worth collapsing: neither could answer
 * "what happened to this machine" on its own. Record edits lived in one, ticket
 * work in another, maintenance runs in a third, and reboot/patch-scan
 * timestamps were buried in a specs panel — so answering the question meant
 * opening three tabs and correlating dates by hand. Merged and lane-filtered,
 * it reads the way the ticket timeline does.
 */
export function AssetTimeline({
  id,
  asset,
  /** Compact mode drops the lane filters and caps rows — for drawers. */
  compact = false,
  maxRows,
  initialHistory,
  initialTickets,
  initialMaintenance,
}: {
  id: string;
  asset: Asset;
  compact?: boolean;
  maxRows?: number;
  /**
   * Server-prefetched data, used as SWR fallback. The asset drawer bundles
   * these in `assetDrawerActions` specifically to avoid a fetch waterfall on
   * open — passing them keeps that guarantee instead of refetching on mount.
   */
  initialHistory?: AssetHistory[] | null;
  initialTickets?: AssetTicketSummary[] | null;
  initialMaintenance?: AssetMaintenanceReport | null;
}) {
  const { t, i18n } = useTranslation('msp/assets');
  const [lane, setLane] = useState<Lane>('all');
  const assetId = asset.asset_id;
  const now = Date.now();

  const { data: tickets } = useSWR(
    assetId ? ['asset', assetId, 'tickets'] : null,
    ([, aid]) => unwrapAssetActionResult(getAssetLinkedTickets(aid)),
    initialTickets ? { fallbackData: initialTickets } : undefined
  );
  const { data: history, isLoading: historyLoading } = useSWR(
    assetId ? ['asset', assetId, 'history'] : null,
    ([, aid]) => unwrapAssetActionResult(getAssetHistory(aid)),
    initialHistory ? { fallbackData: initialHistory } : undefined
  );
  const { data: maintenance } = useSWR(
    assetId ? ['asset', assetId, 'maintenance'] : null,
    ([, aid]) => unwrapAssetActionResult(getAssetMaintenanceReport(aid)),
    initialMaintenance ? { fallbackData: initialMaintenance } : undefined
  );

  const laneLabel = (key: Lane): string => {
    switch (key) {
      case 'service': return t('assetTimeline.lanes.service', { defaultValue: 'Service' });
      case 'changes': return t('assetTimeline.lanes.changes', { defaultValue: 'Changes' });
      case 'maintenance': return t('assetTimeline.lanes.maintenance', { defaultValue: 'Maintenance' });
      case 'system': return t('assetTimeline.lanes.system', { defaultValue: 'System' });
      default: return t('assetTimeline.lanes.all', { defaultValue: 'All' });
    }
  };

  const events: TimelineEvent[] = useMemo(() => {
    const list: TimelineEvent[] = [];
    const ext = asset.workstation ?? asset.server;

    for (const ticket of tickets ?? []) {
      list.push({
        id: `ticket-${ticket.ticket_id}`,
        lane: 'service',
        at: ticket.linked_at,
        icon: Ticket,
        tone: 'info',
        title: ticket.title,
        detail: [ticket.status_name, ticket.priority_name].filter(Boolean).join(' · ') || undefined,
        actor: ticket.assigned_to_name,
      });
    }

    for (const entry of history ?? []) {
      // F035/F078: assignment and group entries get their own wording — the
      // generic "Updated: Contact name id" told nobody anything.
      const described = describeAssetHistoryEntry(entry, t);
      list.push({
        id: `history-${entry.history_id}`,
        lane: 'changes',
        at: entry.changed_at,
        icon: described?.icon ?? Pencil,
        tone: described?.tone ?? 'neutral',
        title: described?.title ?? t(`assetTimeline.changeTypes.${entry.change_type}`, {
          defaultValue: humanise(entry.change_type),
        }),
        detail: described ? described.detail : changeSummary(entry.changes),
        actor: entry.changed_by_name,
      });
    }

    for (const run of maintenance?.maintenance_history ?? []) {
      list.push({
        id: `maintenance-${run.history_id}`,
        lane: 'maintenance',
        at: run.performed_at,
        icon: Wrench,
        tone: 'good',
        title: t('assetTimeline.events.maintenancePerformed', { defaultValue: 'Maintenance performed' }),
        detail: run.notes ?? undefined,
      });
    }

    // Milestones already on the record — the dates a tech reaches for when a
    // machine misbehaves, previously only visible inside a specs panel.
    if (ext?.last_reboot_at) {
      list.push({
        id: 'system-reboot',
        lane: 'system',
        at: ext.last_reboot_at,
        icon: Power,
        tone: 'neutral',
        title: t('assetTimeline.events.lastReboot', { defaultValue: 'Last reboot' }),
      });
    }
    if (ext?.last_patch_scan_at) {
      const pending = (ext.pending_os_patches ?? 0) + (ext.pending_software_patches ?? 0) || ext.pending_patches;
      list.push({
        id: 'system-patch-scan',
        lane: 'system',
        at: ext.last_patch_scan_at,
        icon: ShieldCheck,
        tone: ext.failed_patches ? 'bad' : pending ? 'warn' : 'good',
        title: t('assetTimeline.events.patchScan', { defaultValue: 'Patch scan' }),
        detail: t('assetTimeline.events.patchScanDetail', {
          defaultValue: '{{pending}} pending, {{failed}} failed',
          pending: pending ?? 0,
          failed: ext.failed_patches ?? 0,
        }),
      });
    }
    const purchasedAt = calendarMilestoneAt(asset.purchase_date);
    if (purchasedAt) {
      list.push({
        id: 'system-purchased',
        lane: 'system',
        at: purchasedAt,
        icon: Boxes,
        tone: 'neutral',
        title: t('assetTimeline.events.purchased', { defaultValue: 'Purchased' }),
      });
    }

    return list
      .filter((event) => Boolean(event.at) && !Number.isNaN(new Date(event.at).getTime()))
      .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
  }, [tickets, history, maintenance, asset, t]);

  const counts = useMemo(() => {
    const base: Record<Lane, number> = { all: events.length, service: 0, changes: 0, maintenance: 0, system: 0 };
    for (const event of events) base[event.lane] += 1;
    return base;
  }, [events]);

  const visible = useMemo(() => {
    const filtered = lane === 'all' ? events : events.filter((event) => event.lane === lane);
    return maxRows ? filtered.slice(0, maxRows) : filtered;
  }, [events, lane, maxRows]);

  return (
    <BentoTile
      id={id}
      title={t('assetTimeline.title', { defaultValue: 'Timeline' })}
      icon={<History className="h-4 w-4" />}
      action={<BentoChip>{String(counts.all)}</BentoChip>}
    >
      {!compact ? (
        <div className="mb-3 flex flex-wrap gap-1">
          {(['all', 'service', 'changes', 'maintenance', 'system'] as Lane[])
            .filter((key) => key === 'all' || counts[key] > 0)
            .map((key) => (
              <button
                key={key}
                id={`${id}-lane-${key}`}
                type="button"
                onClick={() => setLane(key)}
                aria-pressed={lane === key}
                className={`rounded-full px-2.5 py-0.5 text-xs font-semibold transition-colors ${
                  lane === key
                    ? 'chip-primary'
                    : 'bg-[rgb(var(--color-border-100))] text-[rgb(var(--color-text-500))] hover:bg-[rgb(var(--color-border-200))]'
                }`}
              >
                {laneLabel(key)}
                <span className="ml-1 font-mono text-[10px] opacity-70">{counts[key]}</span>
              </button>
            ))}
        </div>
      ) : null}

      {historyLoading && events.length === 0 ? (
        <div className="space-y-2">
          <div className="animate-pulse bg-[rgb(var(--color-border-100))] h-10 rounded-md" />
          <div className="animate-pulse bg-[rgb(var(--color-border-100))] h-10 rounded-md" />
        </div>
      ) : visible.length === 0 ? (
        <BentoTileEmpty id={`${id}-empty`}>
          {lane === 'all'
            ? t('assetTimeline.empty', { defaultValue: 'Nothing recorded for this asset yet.' })
            : t('assetTimeline.emptyLane', {
                defaultValue: 'No {{lane}} events recorded.',
                lane: laneLabel(lane).toLowerCase(),
              })}
        </BentoTileEmpty>
      ) : (
        <ul className="relative pl-6">
          <span
            className="absolute left-[7px] top-2 bottom-2 w-px bg-[rgb(var(--color-border-200))]"
            aria-hidden="true"
          />
          {visible.map((event) => {
            const Icon = event.icon;
            return (
              <li key={event.id} className="relative pb-4 last:pb-0 min-w-0">
                <span
                  className="absolute -left-6 top-0.5 flex h-4 w-4 items-center justify-center rounded-full border border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-card))]"
                  aria-hidden="true"
                >
                  <Icon className={`h-2.5 w-2.5 ${BENTO_TONE_TEXT[event.tone]}`} />
                </span>
                <div className="flex items-baseline gap-2 min-w-0">
                  <span className="text-sm font-medium text-[rgb(var(--color-text-800))] truncate min-w-0">
                    {event.title}
                  </span>
                  <span className="ml-auto flex-shrink-0 text-xs text-[rgb(var(--color-text-400))]">
                    {formatEventAge(event.at, now, i18n?.language)}
                  </span>
                </div>
                {event.detail || event.actor ? (
                  <div className="text-xs text-[rgb(var(--color-text-500))] truncate">
                    {[event.detail, event.actor].filter(Boolean).join(' · ')}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      {maxRows && events.length > maxRows ? (
        <p className="mt-2 text-xs text-[rgb(var(--color-text-400))]">
          {t('assetTimeline.moreEvents', {
            defaultValue: 'Showing {{shown}} of {{total}} events.',
            shown: visible.length,
            total: events.length,
          })}
        </p>
      ) : null}
    </BentoTile>
  );
}

export default AssetTimeline;
