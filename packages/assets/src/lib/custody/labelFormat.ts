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
  return { custodyLocation, nextAction };
}

/**
 * A ticket with several held items prints a count only (and no next action), never a list (the label has a fixed
 * line budget). `facts` is in the order the caller wants them to win.
 */
export function formatCustodyForLabelMulti(facts: ReadonlyArray<CustodyLabelFacts>): CustodyLabelFacts | null {
  if (facts.length === 0) return null;
  if (facts.length === 1) return facts[0];
  return { custodyLocation: `${facts.length} items held`, nextAction: null };
}
