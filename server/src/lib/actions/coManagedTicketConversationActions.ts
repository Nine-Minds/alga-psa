'use server';

import { withAuth } from '@alga-psa/auth';
import { createTenantKnex } from '@alga-psa/db';
import { requireCapabilityForAction } from '@alga-psa/core/capability/server';
import { getCoManagedTicketConversation, getCoManagedConversationContributionHints, type CoManagedSharedResource, type CoManagedConversationCursor } from '@alga-psa/co-managed';
import { coManagedBrowserActor } from '../co-managed/browserActor';

// Reading a conversation serves what already exists, so these gate on `serves`.
export const getCoManagedTicketConversationAction = withAuth(async (user, { tenant }, resource: CoManagedSharedResource, before?: CoManagedConversationCursor) => {
  await requireCapabilityForAction('co-managed', tenant, 'serves');
  const actor = await coManagedBrowserActor(user, tenant), { knex } = await createTenantKnex(tenant);
  return getCoManagedTicketConversation(knex, actor, resource, before);
});

/** One page plus the viewer's authority. Attachment limits join this payload in L4b. */
export const getCoManagedTicketConversationScreenAction = withAuth(async (user, { tenant }, resource: CoManagedSharedResource, before?: CoManagedConversationCursor) => {
  await requireCapabilityForAction('co-managed', tenant, 'serves');
  const actor = await coManagedBrowserActor(user, tenant), { knex } = await createTenantKnex(tenant);
  const { writeAudiences } = await getCoManagedConversationContributionHints(knex, actor, resource);
  const conversation = await getCoManagedTicketConversation(knex, actor, resource, before);
  return { ...conversation, actor: { tenant: actor.tenant, userId: actor.userId }, writeAudiences };
});
