// Registers the co-managed delivery provider on the shared-work seam. Imported once at server
// boot inside try/catch; without it every seam answers null and native behaviour is unchanged.
import { coManagedDeliverySeam } from '@alga-psa/shared/lib/coManagedDelivery';
import { createCoManagedDeliveryProvider } from './deliveryProvider';

if (!coManagedDeliverySeam.hasProvider()) coManagedDeliverySeam.register(() => createCoManagedDeliveryProvider());
