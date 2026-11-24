import type { EmulatorPackage } from '@alga-psa/emulator-host';
import { StripeEmulatorCore } from './core';
import { register } from './register';
import { wire } from './wire';

const stripeEmulator: EmulatorPackage<StripeEmulatorCore> = {
  id: 'stripe',
  displayName: 'Stripe',
  defaultPort: 4050,
  createCore: (env) => new StripeEmulatorCore(env),
  wire,
  register,
};

export default stripeEmulator;
export { stripeEmulator as emulator };
export { StripeEmulatorCore, StripeWireError, toStripeAddress } from './core';
export type { StripeAddress, StripeAddressInput, StripeBillingDetailsInput } from './core';
export { signStripePayload, deliverEvent } from './notifier';
export type {
  StripeCheckoutSession,
  StripeCustomer,
  StripePaymentIntent,
  StripeEvent,
  WebhookDelivery,
} from './core';
