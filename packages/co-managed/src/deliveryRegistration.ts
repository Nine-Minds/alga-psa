// Registers the co-managed delivery provider on the shared-work seam. Imported once at server
// boot inside try/catch; without it every seam answers null and native behaviour is unchanged.
import { coManagedDeliverySeam, coManagedWorkflowTicketSeam } from '@alga-psa/shared/lib/coManagedDelivery';
import { retainCoManagedWorkflowTicketAuthority } from './workflowTicketAuthority';
import { createCoManagedDeliveryProvider } from './deliveryProvider';

if (!coManagedDeliverySeam.hasProvider()) coManagedDeliverySeam.register(() => createCoManagedDeliveryProvider());

// Workflow ticket-mutation authority (L4a). Same best-effort boot import as the delivery provider.
if (!coManagedWorkflowTicketSeam.hasProvider()) {
  coManagedWorkflowTicketSeam.register(() => ({ retain: async (trx, input) => { await retainCoManagedWorkflowTicketAuthority(trx as never, input); } }));
}
