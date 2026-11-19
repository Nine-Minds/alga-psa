/**
 * Registers the catalog-backed "is anything sellable" probe with the licensing purchase surface.
 * Import for its side effect from every entry point that asks `isCoManagedPurchaseSurfaceOpen`.
 * Fail closed: any error reads as "not sellable".
 */
import { registerCoManagedOfferAvailability } from '@alga-psa/licensing';
import { getStripeService } from '../StripeService';
import { CO_MANAGED_SEAT_OFFER_KEY } from './types';

registerCoManagedOfferAvailability(async () => {
  const catalog = await getStripeService().getOfferCatalog();
  return catalog.isOfferSellable(CO_MANAGED_SEAT_OFFER_KEY, 'month');
});
