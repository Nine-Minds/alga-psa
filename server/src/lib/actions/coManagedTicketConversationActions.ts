'use server';

import { withAuth } from '@alga-psa/auth';
import { createTenantKnex } from '@alga-psa/db';
import { getCoManagedTicketConversation, getCoManagedConversationContributionHints, type CoManagedSharedResource, type CoManagedConversationCursor } from '@alga-psa/co-managed';
import { coManagedAttachmentUploadLimit } from '../co-managed/attachmentUploadLimit';
import { coManagedBrowserActor } from '../co-managed/browserActor';

export const getCoManagedTicketConversationAction = withAuth(async (user, { tenant }, resource: CoManagedSharedResource, before?: CoManagedConversationCursor) => {
  const actor = await coManagedBrowserActor(user, tenant), { knex } = await createTenantKnex(tenant);
  return getCoManagedTicketConversation(knex, actor, resource, before);
});

export const getCoManagedTicketConversationScreenAction = withAuth(async (user, { tenant }, resource: CoManagedSharedResource, before?: CoManagedConversationCursor) => {
  const actor = await coManagedBrowserActor(user, tenant), { knex } = await createTenantKnex(tenant);
  const { writeAudiences, attachmentAudiences } = await getCoManagedConversationContributionHints(knex, actor, resource);
  const maxBytes = coManagedAttachmentUploadLimit();
  const conversation = await getCoManagedTicketConversation(knex, actor, resource, before);
  return { ...conversation, actor: { tenant: actor.tenant, userId: actor.userId }, writeAudiences,
    draftAttachments: { audiences: maxBytes > 0 ? attachmentAudiences : [], maxBytes, maxFiles: 20 } };
});
