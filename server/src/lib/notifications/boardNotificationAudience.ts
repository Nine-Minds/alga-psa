import type { Knex } from 'knex';
import { getUserWithRoles } from '@alga-psa/db';
import { hasPermission } from '@alga-psa/auth/rbac';
import { authorizeTicketRecordAccess } from '@alga-psa/tickets/lib/ticketRecordAuthorization';
import type { ResolvedRecipient } from '@alga-psa/shared/lib/tickets/boardNotificationRules';

/**
 * Visibility filter for board notification rule recipients: a queue alert must
 * not leak the title or client of a ticket the recipient cannot open. Keeps
 * recipients with RBAC `ticket:read` who also pass the per-record policy
 * (which covers EE board-scoped authorization bundles).
 *
 * Lives in server/ because it depends on @alga-psa/auth and @alga-psa/tickets,
 * which shared/ must not import.
 */
export async function filterRecipientsWhoCanReadTicket(
  db: Knex | Knex.Transaction,
  tenant: string,
  ticketId: string,
  recipients: ResolvedRecipient[]
): Promise<ResolvedRecipient[]> {
  const allowed: ResolvedRecipient[] = [];
  for (const recipient of recipients) {
    try {
      const user = await getUserWithRoles(recipient.userId, tenant);
      if (!user) continue;
      if (!(await hasPermission(user, 'ticket', 'read', db))) continue;
      await authorizeTicketRecordAccess({ trx: db, tenant, user, ticketId, action: 'read' });
      allowed.push(recipient);
    } catch {
      // Denied (or unresolvable) recipients are dropped rather than failing the whole event.
    }
  }
  return allowed;
}
