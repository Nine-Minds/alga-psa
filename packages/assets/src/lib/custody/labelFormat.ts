import type { IAssetCustodyDetail } from '@alga-psa/types';

/**
 * The custody line printed on a ticket work tag (design D7): where the item is and who acts next,
 * and nothing else. It never includes the free-text next-action note, the condition note, accessories,
 * holder names or serials.
 */

export interface CustodyLabelFacts {
  /** "Main Office / Shelf B3", "With vendor", or null when nothing should print. */
  custodyLocation: string | null;
  /** "Follow up Oct 29" or "Waiting on client", or null. */
  nextAction: string | null;
  /**
   * The raw `YYYY-MM-DD` follow-up date behind `nextAction`. Carried only so a several-items summary can pick the
   * earliest date; it is never printed directly (the printed form is `nextAction`).
   */
  followUpOn: string | null;
}

const PARTY_LABEL = { msp: 'Our turn', client: 'Waiting on client', vendor: 'Waiting on vendor' } as const;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** `YYYY-MM-DD` -> "Oct 29". Pure string handling: a date-only value must never pass through a Date/time zone. */
export function formatFollowUpDate(date: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return null;
  const month = MONTHS[Number(m[2]) - 1];
  return month ? `${month} ${Number(m[3])}` : null;
}

export function formatCustodyForLabel(
  custody: Pick<IAssetCustodyDetail, 'state' | 'location_name' | 'bin' | 'next_action_party' | 'follow_up_on'> | null | undefined
): CustodyLabelFacts | null {
  if (!custody || custody.state === 'closed') return null;
  const custodyLocation =
    custody.state === 'with_vendor'
      ? 'With vendor'
      : [custody.location_name, custody.bin].filter((s): s is string => Boolean(s && s.trim())).join(' / ') || null;
  const followUp = custody.follow_up_on ? formatFollowUpDate(custody.follow_up_on) : null;
  const nextAction =
    custody.next_action_party !== 'msp'
      ? PARTY_LABEL[custody.next_action_party] + (followUp ? `, ${followUp}` : '')
      : followUp
        ? `Follow up ${followUp}`
        : null;
  if (!custodyLocation && !nextAction) return null;
  return { custodyLocation, nextAction, followUpOn: followUp ? custody.follow_up_on : null };
}

/**
 * The custody line for ONE label (the rule is pure; the caller does the reads).
 *  - `pick` non-null: the picked item decides, verbatim (`pick.facts`). A picked item with no open custody has
 *    `facts: null` and prints no line - it never falls back to the ticket-level count.
 *  - no pick, nothing held: no line. One held item: that item. Several: "<n> items held" plus the earliest
 *    follow-up date across them, worded without a party (the line summarises items with different parties).
 * `held` is every readable held item on the ticket, in caller order.
 */
export function formatCustodyForLabelSubject(
  held: ReadonlyArray<CustodyLabelFacts>,
  pick: { facts: CustodyLabelFacts | null } | null
): CustodyLabelFacts | null {
  if (pick) return pick.facts;
  if (held.length === 0) return null;
  if (held.length === 1) return held[0];
  // ISO date-only strings sort lexicographically.
  const earliest = held.map((h) => h.followUpOn).filter((d): d is string => Boolean(d)).sort()[0] ?? null;
  const formatted = earliest ? formatFollowUpDate(earliest) : null;
  return {
    custodyLocation: `${held.length} items held`,
    nextAction: formatted ? `Follow up ${formatted}` : null,
    followUpOn: formatted ? earliest : null,
  };
}
