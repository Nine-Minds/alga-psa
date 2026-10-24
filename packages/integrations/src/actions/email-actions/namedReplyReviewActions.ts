'use server';

import { withAuth, getSession, getApiKeyUserOverride } from '@alga-psa/auth';
import { createTenantKnex } from '@alga-psa/db';
import { listNamedReplyReviews, getNamedReplyReview, resolveNamedReplyReview, CoManagedSharedWorkError,
  type ResolveNamedReplyReviewRequest } from '@alga-psa/co-managed';

async function reviewContext(user: { user_id: string; user_type?: string }, tenant: string) {
  // LEVERAGE: pattern co-managed-browser-identity — keep mailbox review bound to the tracked home session.
  if (getApiKeyUserOverride() || user.user_type !== 'internal') throw new CoManagedSharedWorkError();
  const session = await getSession();
  if (!session?.session_id || session.user?.tenant !== tenant || session.user.id !== user.user_id || session.user.user_type !== 'internal') throw new CoManagedSharedWorkError();
  const { knex } = await createTenantKnex(tenant);
  return { knex, actor: { kind: 'session' as const, tenant, userId: user.user_id, sessionId: session.session_id } };
}
export const listNamedReplyReviewsAction = withAuth(async (user, { tenant }, offset: number = 0) => {
  const { knex, actor } = await reviewContext(user, tenant);
  return listNamedReplyReviews(knex, actor, offset);
});
export const getNamedReplyReviewAction = withAuth(async (user, { tenant }, inboxId: string) => {
  const { knex, actor } = await reviewContext(user, tenant);
  return getNamedReplyReview(knex, actor, inboxId);
});
export const resolveNamedReplyReviewAction = withAuth(async (user, { tenant }, request: ResolveNamedReplyReviewRequest) => {
  const { knex, actor } = await reviewContext(user, tenant);
  return resolveNamedReplyReview(knex, actor, request);
});
