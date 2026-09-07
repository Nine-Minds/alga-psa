import type { Knex } from 'knex';
import { getApiKeyUserOverride, getSession } from '@alga-psa/auth';
import { hasCoManagedConversationOwnership } from '@alga-psa/co-managed/nativeConversationEvents';
import { admitCoManagedScheduledCommentCommand } from '@alga-psa/co-managed/scheduledCommentCommands';
import { CoManagedSharedWorkError } from '@alga-psa/co-managed';

/** This browser command never borrows an ambient session for an API override. */
export async function admitScheduledCommentCommand(trx: Knex.Transaction, tenant: string,
  user: { user_id: string; user_type?: string }, input: { commentId: string; ticketId: string; operation: 'create' | 'reschedule' | 'cancel' }): Promise<() => Promise<void>> {
  if (!await hasCoManagedConversationOwnership(trx, tenant)) return async () => {};
  if (getApiKeyUserOverride() || user.user_type !== 'internal') throw new CoManagedSharedWorkError();
  // LEVERAGE: pattern co-managed-browser-identity — browser adapters bind the tracked home session and reject automation overrides.
  const session = await getSession();
  if (!session?.session_id || session.user?.tenant !== tenant || session.user?.id !== user.user_id || session.user?.user_type !== 'internal') throw new CoManagedSharedWorkError();
  return admitCoManagedScheduledCommentCommand(trx, { kind: 'session', tenant, userId: user.user_id, sessionId: session.session_id }, input);
}
