import { z } from 'zod';
import { tenantDb } from '@alga-psa/db';
import type { ActionContext } from '../../registries/actionRegistry';
import { withWorkflowPicker } from '../../jsonSchemaMetadata';
import { uuidSchema, throwActionError, type TenantTxContext } from './shared';

/**
 * Users and roles a workflow step addresses by reference. Shared by every action that turns a
 * recipient spec into users (notifications.send_in_app, email.send).
 */
export const workflowUserRecipientsSchema = z.object({
  user_ids: withWorkflowPicker(z.array(uuidSchema).optional(), 'Users', 'user'),
  role_ids: withWorkflowPicker(z.array(uuidSchema).optional(), 'Roles (every user with one of these roles)', 'role'),
  role_names: z.array(z.string().min(1)).optional().describe('Role names (case-insensitive)'),
});

export type WorkflowTicketAssigneeScope = 'assigned' | 'assigned_and_additional';

export type WorkflowUserRecipientSpec = z.infer<typeof workflowUserRecipientsSchema> & {
  ticket?: { ticket_id: string; assignees: WorkflowTicketAssigneeScope };
};

export type ResolvedWorkflowUserSource = 'user' | 'role' | 'ticket_assigned' | 'ticket_additional';

export type ResolvedWorkflowUser = {
  user_id: string;
  email: string | null;
  display_name: string;
  user_type: 'internal' | 'client';
  is_inactive: boolean;
  sources: ResolvedWorkflowUserSource[];
};

export type EmailSkipReason = 'inactive' | 'not_internal' | 'no_email';

export type EmailRecipient = { email: string; name?: string };

const uniqueStrings = (values: string[]): string[] => Array.from(new Set(values));

/** Every non-null additional resource (ticket_resources.additional_user_id) of a ticket, in assignment order. */
export const getCurrentTicketAdditionalUserIds = async (
  tx: { tenantId: string; trx: any },
  ticketId: string
): Promise<string[]> => {
  const rows = await tenantDb(tx.trx, tx.tenantId)
    .table('ticket_resources')
    .where('ticket_id', ticketId)
    .whereNotNull('additional_user_id')
    .orderBy('assigned_at')
    .select('additional_user_id');

  return uniqueStrings(
    rows
      .map((row: { additional_user_id: string | null }) => row.additional_user_id)
      .filter((userId: string | null): userId is string => typeof userId === 'string' && userId.length > 0)
  );
};

/**
 * Turns a recipient spec into users. Applies no delivery policy: inactive users, client users and
 * users without an address are returned, classified, for the caller to decide on.
 */
export async function resolveWorkflowUserRecipients(
  tx: TenantTxContext,
  ctx: ActionContext,
  spec: WorkflowUserRecipientSpec
): Promise<ResolvedWorkflowUser[]> {
  const db = tenantDb(tx.trx, tx.tenantId);
  const sourcesByUser = new Map<string, Set<ResolvedWorkflowUserSource>>();
  const add = (userId: string, source: ResolvedWorkflowUserSource) => {
    const existing = sourcesByUser.get(userId);
    if (existing) existing.add(source);
    else sourcesByUser.set(userId, new Set([source]));
  };

  // First-seen order: ticket assigned, ticket additional, users, then roles.
  if (spec.ticket) {
    const ticket = await db.table('tickets')
      .where('ticket_id', spec.ticket.ticket_id)
      .select('ticket_id', 'assigned_to')
      .first();
    if (!ticket) {
      throwActionError(ctx, {
        category: 'ActionError',
        code: 'NOT_FOUND',
        message: 'Ticket not found',
        details: { ticket_id: spec.ticket.ticket_id },
      });
    }
    if (ticket.assigned_to) add(ticket.assigned_to, 'ticket_assigned');
    if (spec.ticket.assignees === 'assigned_and_additional') {
      for (const userId of await getCurrentTicketAdditionalUserIds(tx, spec.ticket.ticket_id)) {
        add(userId, 'ticket_additional');
      }
    }
  }

  const explicitUserIds = uniqueStrings(Array.isArray(spec.user_ids) ? spec.user_ids : []);
  explicitUserIds.forEach((userId) => add(userId, 'user'));

  const resolvedRoleIds: string[] = [];
  const roleIds = Array.isArray(spec.role_ids) ? spec.role_ids : [];
  const roleNames = Array.isArray(spec.role_names) ? spec.role_names : [];
  if (roleIds.length) resolvedRoleIds.push(...roleIds);
  if (roleNames.length) {
    const roleNamesLower = roleNames.map((name) => name.toLowerCase());
    const roles = await db.table('roles')
      .andWhere(function matchRoleNames() {
        roleNamesLower.forEach((name) => {
          this.orWhereRaw('lower(role_name) = ?', [name]);
        });
      })
      .select('role_id');
    resolvedRoleIds.push(...roles.map((role: any) => role.role_id));
  }
  if (resolvedRoleIds.length) {
    const members = await db.table('user_roles').whereIn('role_id', resolvedRoleIds).select('user_id');
    members.forEach((row: any) => add(row.user_id, 'role'));
  }

  const allUserIds = Array.from(sourcesByUser.keys());
  if (!allUserIds.length) return [];

  const rows = await db.table('users')
    .whereIn('user_id', allUserIds)
    .select('user_id', 'email', 'first_name', 'last_name', 'username', 'user_type', 'is_inactive');
  const rowById = new Map<string, any>(rows.map((row: any) => [row.user_id, row]));

  // An explicitly picked user that no longer exists is a definition fault: fail fast.
  const missing = explicitUserIds.filter((userId) => !rowById.has(userId));
  if (missing.length) {
    throwActionError(ctx, {
      category: 'ActionError',
      code: 'NOT_FOUND',
      message: 'One or more users not found',
      details: { missing_user_ids: missing },
    });
  }

  const resolved: ResolvedWorkflowUser[] = [];
  for (const [userId, sources] of sourcesByUser) {
    const row = rowById.get(userId);
    if (!row) continue;
    const fullName = `${row.first_name ?? ''} ${row.last_name ?? ''}`.trim();
    resolved.push({
      user_id: userId,
      email: typeof row.email === 'string' ? row.email : null,
      display_name: fullName || String(row.username ?? ''),
      user_type: row.user_type === 'client' ? 'client' : 'internal',
      is_inactive: Boolean(row.is_inactive),
      sources: Array.from(sources),
    });
  }
  return resolved;
}

/** Email delivery policy: only active internal users with an address are emailed. */
export function selectEmailableUsers(users: ResolvedWorkflowUser[]): {
  recipients: Array<{ user_id: string; email: string; name: string }>;
  skipped: Array<{ user_id: string; reason: EmailSkipReason }>;
} {
  const recipients: Array<{ user_id: string; email: string; name: string }> = [];
  const skipped: Array<{ user_id: string; reason: EmailSkipReason }> = [];
  for (const user of users) {
    if (user.is_inactive) skipped.push({ user_id: user.user_id, reason: 'inactive' });
    else if (user.user_type !== 'internal') skipped.push({ user_id: user.user_id, reason: 'not_internal' });
    else if (!user.email || !user.email.trim()) skipped.push({ user_id: user.user_id, reason: 'no_email' });
    else recipients.push({ user_id: user.user_id, email: user.email.trim(), name: user.display_name });
  }
  return { recipients, skipped };
}

/**
 * Builds the final To/Cc/Bcc lists: internal recipients go where `placeAs` says, and an address
 * appears once across all three lists (case-insensitive; To wins over Cc, Cc over Bcc).
 */
export function mergeEmailRecipients(
  lists: { to?: EmailRecipient[]; cc?: EmailRecipient[]; bcc?: EmailRecipient[] },
  internal: Array<{ email: string; name?: string }>,
  placeAs: 'to' | 'cc' | 'bcc'
): { to: EmailRecipient[]; cc: EmailRecipient[]; bcc: EmailRecipient[]; total: number } {
  const combined = {
    to: [...(lists.to ?? [])],
    cc: [...(lists.cc ?? [])],
    bcc: [...(lists.bcc ?? [])],
  };
  combined[placeAs].push(...internal.map(({ email, name }) => (name ? { email, name } : { email })));

  const seen = new Set<string>();
  const dedupe = (list: EmailRecipient[]): EmailRecipient[] =>
    list.filter((recipient) => {
      const key = recipient.email.trim().toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

  const to = dedupe(combined.to);
  const cc = dedupe(combined.cc);
  const bcc = dedupe(combined.bcc);
  return { to, cc, bcc, total: to.length + cc.length + bcc.length };
}
