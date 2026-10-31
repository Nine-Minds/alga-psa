import type { CommentAudience } from '@alga-psa/shared/lib/commentAudience';
import type { DeliveryRecipient } from '@alga-psa/shared/lib/coManagedDelivery';

/** Everyone who could be addressed on a shared ticket. Resolution of these lists is the caller's job. */
export interface ThreadParticipants {
  /** MSP-side (sponsor tenant) users: assignee, team members. */
  sponsorUsers: DeliveryRecipient[];
  sponsorTeams: DeliveryRecipient[];
  /** Customer-tenant (store tenant) users. */
  customerUsers: DeliveryRecipient[];
  /** The requester contact on the ticket. */
  requester: DeliveryRecipient | null;
}

/**
 * Pure audience -> recipients. The audience is the only input that decides reach:
 *   requester            -> requester contact + customer users (the requester thread)
 *   shared_it            -> sponsor users/teams + customer users (IT on both sides); never the requester
 *   organization_private -> customer-tenant users only; no sponsor tenant, no requester
 * Never derived from `is_internal`.
 */
export function recipientsForAudience(audience: CommentAudience, p: ThreadParticipants): DeliveryRecipient[] {
  const out: DeliveryRecipient[] = [];
  switch (audience) {
    case 'requester':
      if (p.requester) out.push(p.requester);
      out.push(...p.customerUsers, ...p.sponsorUsers, ...p.sponsorTeams);
      break;
    case 'shared_it':
      out.push(...p.customerUsers, ...p.sponsorUsers, ...p.sponsorTeams);
      break;
    case 'organization_private':
      out.push(...p.customerUsers);
      break;
    default:
      return [];
  }
  const seen = new Set<string>();
  return out.filter((r) => {
    const key = `${r.kind}:${r.principalId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
