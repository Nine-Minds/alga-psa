import Stripe from 'stripe';
import { stripeApiOverride } from '../stripe/stripeApiOverride';

/** Build Stripe clients consistently, preserving SDK defaults outside simulator runs. */
export function createStripeClient(secretKey: string): Stripe {
  const options: Stripe.StripeConfig = { apiVersion: '2024-12-18.acacia' as any, typescript: true };
  Object.assign(options, stripeApiOverride(secretKey));
  return new Stripe(secretKey, options);
}
