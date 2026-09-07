'use server';
import { withAuth } from '@alga-psa/auth';
import { getConnection } from '@alga-psa/db';
import { coManagedPortalBrowserActor } from '../co-managed/browserActor';
import { listPortalConversationAttachments, type PortalAttachmentTarget } from '../co-managed/portalAttachments';

export const getPortalConversationAttachmentsAction = withAuth(async (user, { tenant }, target: PortalAttachmentTarget) => {
  const actor = await coManagedPortalBrowserActor(user, tenant);
  const attachments = await listPortalConversationAttachments(await getConnection(tenant), actor, target);
  return { actor: { tenant: actor.tenant, userId: actor.userId }, attachments };
});
