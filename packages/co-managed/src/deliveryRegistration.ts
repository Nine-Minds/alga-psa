// Registers the co-managed delivery provider on the shared-work seam. Imported once at server
// boot inside try/catch; without it every seam answers null and native behaviour is unchanged.
import { coManagedDeliverySeam, coManagedWorkflowTicketSeam } from '@alga-psa/shared/lib/coManagedDelivery';
import { retainCoManagedWorkflowTicketAuthority } from './workflowTicketAuthority';
import { createCoManagedDeliveryProvider } from './deliveryProvider';
import { registerCoManagedInboundCommentWriter } from './inboundCommentWriter';

if (!coManagedDeliverySeam.hasProvider()) coManagedDeliverySeam.register(() => createCoManagedDeliveryProvider());

// Workflow ticket-mutation authority (L4a). Same best-effort boot import as the delivery provider.
if (!coManagedWorkflowTicketSeam.hasProvider()) {
  coManagedWorkflowTicketSeam.register(() => ({ retain: async (trx, input) => { await retainCoManagedWorkflowTicketAuthority(trx as never, input); } }));
}

// Inbound reply writer (CM L5). Registered here, not in server/, so every process that handles
// inbound mail (server, unified queue consumer bin, email-service) has the same seams.
registerCoManagedInboundCommentWriter();
