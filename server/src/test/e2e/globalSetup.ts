/**
 * Playwright global setup: boots the Stripe-like emulator for e2e runs that
 * exercise invoice payment links.
 *
 * The emulator is only started when PLAYWRIGHT_PAYMENT_LINKS=1 is set (the
 * explicit test configuration that also injects the STRIPE_* env into the
 * Next.js webServer). It listens on port 4050 (Stripe /v1 + hosted Checkout)
 * and its control API on 9500, matching the emulator suite's defaults.
 */
import { EmulatorHost } from '@alga-psa/emulator-host';
import stripeEmulator from '@alga-psa/emulator-stripe';

let host: EmulatorHost | null = null;

export default async function globalSetup(): Promise<() => Promise<void>> {
  if (process.env.PLAYWRIGHT_PAYMENT_LINKS !== '1') {
    return async () => undefined;
  }

  host = new EmulatorHost({
    emulators: [stripeEmulator],
    controlPort: 9500,
    ports: { stripe: 4050 },
  });
  await host.start();

  return async () => {
    await host?.stop();
    host = null;
  };
}
