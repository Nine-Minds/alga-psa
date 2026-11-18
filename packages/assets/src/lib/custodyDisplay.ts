/**
 * Pure display helpers for equipment custody (alga-2026-0002683, C4). No React, no server imports, so they
 * are usable from the card, the queue, the list badge and the timeline, and cheap to unit-test.
 *
 * Calendar dates (`follow_up_on`) are `YYYY-MM-DD` strings and stay strings: they are compared and formatted
 * with string handling only, never through `Date`/time zones.
 */

export type TranslateFn = (key: string, options?: Record<string, unknown>) => string;

const CALENDAR_DATE = /^(\d{4})-(\d{2})-(\d{2})/;

/** "Main Office / Shelf B3"; the bin is optional. Null when there is no location at all. */
export function formatCustodyPlace(
  locationName: string | null | undefined,
  bin: string | null | undefined
): string | null {
  const parts = [locationName, bin].map((p) => (typeof p === 'string' ? p.trim() : '')).filter(Boolean);
  return parts.length ? parts.join(' / ') : null;
}

/** True when the follow-up date is strictly before `today` (both `YYYY-MM-DD`; ISO strings compare lexically). */
export function isFollowUpOverdue(followUpOn: string | null | undefined, today: string): boolean {
  const m = followUpOn ? CALENDAR_DATE.exec(followUpOn) : null;
  const t = CALENDAR_DATE.exec(today);
  if (!m || !t) return false;
  return `${m[1]}-${m[2]}-${m[3]}` < `${t[1]}-${t[2]}-${t[3]}`;
}

/** Whole days between an ISO instant and `now` (never negative). */
export function daysHeldSince(openedAt: string, now: number): number {
  const opened = new Date(openedAt).getTime();
  if (!Number.isFinite(opened)) return 0;
  return Math.max(0, Math.floor((now - opened) / 86_400_000));
}

const str = (value: unknown): string | null => (typeof value === 'string' && value.trim() ? value.trim() : null);

export interface CustodyHistoryDescription {
  title: string;
  detail?: string;
  kind: 'received' | 'moved' | 'handed_off' | 'shipped' | 'returned' | 'updated';
  tone: 'good' | 'info' | 'warn' | 'neutral';
}

const CUSTODY_FIELD_KEYS = [
  'purpose',
  'next_action_party',
  'next_action_note',
  'follow_up_on',
  'condition_note',
  'accessories',
] as const;

/**
 * Wording for `asset_history` rows written by the custody services (`custody_received`, `custody_moved`,
 * `custody_handed_off`, `custody_shipped`, `custody_returned`, `custody_updated`). `changes` carries the
 * names, so no lookups are needed. Returns null for anything that is not a custody entry.
 */
export function describeCustodyHistory(
  entry: { change_type: string; changes?: Record<string, unknown> | null },
  t: TranslateFn
): CustodyHistoryDescription | null {
  if (!entry.change_type.startsWith('custody_')) return null;
  const c = (entry.changes ?? {}) as Record<string, unknown>;
  const unknownPlace = t('assetTimeline.custody.unknownPlace', { defaultValue: 'an unknown location' });
  const from = formatCustodyPlace(str(c.from_location_name), str(c.from_bin));
  const to = formatCustodyPlace(str(c.to_location_name), str(c.to_bin));
  const fromHolder = str(c.from_holder_name);
  const toHolder = str(c.to_holder_name);
  const counterparty = str(c.counterparty);
  const purpose = str(c.purpose);
  const ticketNumber = str(c.ticket_number);

  const detailParts: string[] = [];
  if (purpose) {
    detailParts.push(t(`custody.purpose.${purpose}`, { defaultValue: purpose.replace(/_/g, ' ') }));
  }
  if (ticketNumber) {
    detailParts.push(t('assetTimeline.custody.ticket', { defaultValue: 'Ticket {{ticket}}', ticket: ticketNumber }));
  }
  const detail = detailParts.length ? detailParts.join(' · ') : undefined;

  switch (entry.change_type) {
    case 'custody_received': {
      // Receive-back writes from_* keys (null while the item was with a vendor); first intake does not.
      const isReceiveBack = 'from_location_id' in c || 'from_holder_user_id' in c;
      return {
        kind: 'received',
        tone: 'good',
        title: isReceiveBack
          ? t('assetTimeline.custody.receivedBack', {
              defaultValue: 'Received back at {{place}}',
              place: to ?? unknownPlace,
            })
          : t('assetTimeline.custody.received', {
              defaultValue: 'Received into custody at {{place}}',
              place: to ?? unknownPlace,
            }),
        detail,
      };
    }
    case 'custody_moved':
      return {
        kind: 'moved',
        tone: 'info',
        title:
          from && to
            ? t('assetTimeline.custody.moved', {
                defaultValue: 'Moved from {{from}} to {{to}}',
                from,
                to,
              })
            : t('assetTimeline.custody.movedTo', { defaultValue: 'Moved to {{to}}', to: to ?? unknownPlace }),
        detail,
      };
    case 'custody_handed_off':
      return {
        kind: 'handed_off',
        tone: 'info',
        title:
          fromHolder && toHolder
            ? t('assetTimeline.custody.handedOff', {
                defaultValue: 'Handed off from {{from}} to {{to}}',
                from: fromHolder,
                to: toHolder,
              })
            : t('assetTimeline.custody.handedOffTo', {
                defaultValue: 'Handed off to {{to}}',
                to: toHolder ?? t('assetTimeline.custody.aColleague', { defaultValue: 'a colleague' }),
              }),
        detail,
      };
    case 'custody_shipped':
      return {
        kind: 'shipped',
        tone: 'warn',
        title: counterparty
          ? t('assetTimeline.custody.shipped', { defaultValue: 'Shipped to {{counterparty}}', counterparty })
          : t('assetTimeline.custody.shippedVendor', { defaultValue: 'Shipped to vendor' }),
        detail,
      };
    case 'custody_returned':
      return {
        kind: 'returned',
        tone: 'good',
        title: counterparty
          ? t('assetTimeline.custody.returnedTo', { defaultValue: 'Returned to client ({{counterparty}})', counterparty })
          : t('assetTimeline.custody.returned', { defaultValue: 'Returned to client' }),
        detail,
      };
    case 'custody_updated': {
      const fields = (c.fields && typeof c.fields === 'object' ? c.fields : {}) as Record<string, unknown>;
      const names = CUSTODY_FIELD_KEYS.filter((key) => key in fields).map((key) =>
        t(`assetTimeline.custody.fields.${key}`, { defaultValue: key.replace(/_/g, ' ') })
      );
      return {
        kind: 'updated',
        tone: 'neutral',
        title: t('assetTimeline.custody.updated', { defaultValue: 'Custody details updated' }),
        detail: names.length ? names.join(', ') : undefined,
      };
    }
    default:
      return null;
  }
}

/**
 * Adapts an `asset_custody_events` row (with display names) to the `asset_history` shape so the card's
 * History list and the timeline use one set of sentences. `isReceiveBack` is true for any `received`
 * event after the first one in its episode.
 */
export function custodyEventToHistoryEntry(
  event: {
    event_type: string;
    from_location_name?: string | null;
    from_bin?: string | null;
    to_location_name?: string | null;
    to_bin?: string | null;
    from_holder_name?: string | null;
    to_holder_name?: string | null;
    counterparty?: string | null;
    document_ids?: string[] | null;
  },
  isReceiveBack = false
): { change_type: string; changes: Record<string, unknown>; documentIds: string[] } {
  return {
    change_type: `custody_${event.event_type}`,
    documentIds: event.document_ids ?? [],
    changes: {
      from_location_name: event.from_location_name ?? null,
      from_bin: event.from_bin ?? null,
      to_location_name: event.to_location_name ?? null,
      to_bin: event.to_bin ?? null,
      from_holder_name: event.from_holder_name ?? null,
      to_holder_name: event.to_holder_name ?? null,
      counterparty: event.counterparty ?? null,
      ...(isReceiveBack ? { from_location_id: null } : {}),
    },
  };
}
