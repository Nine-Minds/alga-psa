import { readFileSync } from 'node:fs';
import net from 'node:net';
import type { Server } from 'node:net';
import yaml from 'js-yaml';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { EmulatorHost } from '@alga-psa/emulator-host';
import stripeEmulator from '../../../../../../packages/emulators/stripe/src/index';
import { createProviderIngressServer } from '../../../../../../e2e-tests/harness/provider-ingress.mjs';
import { createStripeClient } from '../../../lib/payments/stripeClient';

// Interpret Compose's collection tags without needing to start the app stack.
const schema = yaml.DEFAULT_SCHEMA.extend(['!reset', '!override'].flatMap(tag =>
  (['sequence', 'mapping', 'scalar'] as const).map(kind => new yaml.Type(tag, { kind, construct: data => data })),
));
type ComposeEnvironment = { services: Record<string, { environment: Record<string, string> }> };
const compose = yaml.load(readFileSync(new URL('../../../../../../docker-compose.e2e-emulators.yaml', import.meta.url), 'utf8'), { schema }) as ComposeEnvironment;
const production = yaml.load(readFileSync(new URL('../../../../../../docker-compose.prod.yaml', import.meta.url), 'utf8'), { schema }) as ComposeEnvironment;

describe('production Stripe SDK through the E2E loopback transport', () => {
  let host: EmulatorHost;
  let proxy: Server;
  let baseUrl: string;
  let controlBase: string;
  const destinations: net.NetConnectOpts[] = [];

  beforeAll(async () => {
    host = new EmulatorHost({ emulators: [stripeEmulator], controlPort: 0, ports: { stripe: 0 }, log() {} });
    const addresses = await host.start();
    controlBase = `http://127.0.0.1:${addresses.controlPort}`;
    // Docker resolves the fixed algasim destination; map only that hop to the
    // ephemeral vendor port locally. The SDK still traverses the real proxy.
    proxy = createProviderIngressServer(4050, { connect: (destination: net.NetConnectOpts) => {
      destinations.push(destination);
      return net.connect({ host: '127.0.0.1', port: addresses.ports.stripe });
    } });
    await new Promise<void>((resolve, reject) => {
      proxy.once('error', reject);
      proxy.listen(0, '127.0.0.1', resolve);
    });
    const address = proxy.address();
    if (!address || typeof address === 'string') throw new Error('Stripe proxy has no TCP address');
    const endpoint = new URL(compose.services.server.environment.STRIPE_API_BASE_URL);
    endpoint.port = String(address.port);
    baseUrl = endpoint.href;
  });

  beforeEach(() => {
    vi.stubEnv('NODE_ENV', production.services.server.environment.NODE_ENV);
    vi.stubEnv('ALGA_STRIPE_LOCAL_REVIEW', compose.services.server.environment.ALGA_STRIPE_LOCAL_REVIEW);
    vi.stubEnv('STRIPE_API_BASE_URL', baseUrl);
    destinations.length = 0;
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    if (proxy) await new Promise<void>((resolve, reject) => proxy.close(error => error ? reject(error) : resolve()));
    await host?.stop();
  });

  it('verifies the tenant account and creates a customer through the production-configured SDK', async () => {
    const seeded = await fetch(`${controlBase}/control/stripe/seed/config`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ secretKey: 'sk_test_algasim', accountId: 'acct_production_transport' }),
    });
    expect(seeded.ok).toBe(true);
    const stripe = createStripeClient('sk_test_algasim');
    await expect(stripe.accounts.retrieve()).resolves.toMatchObject({ id: 'acct_production_transport' });
    await expect(stripe.customers.create({ name: 'Production transport regression', email: 'transport@example.test' })).resolves.toMatchObject({ name: 'Production transport regression' });
    expect(destinations.length).toBeGreaterThan(0);
    expect(destinations.every(destination => 'host' in destination && destination.host === 'algasim' && 'port' in destination && destination.port === 4050)).toBe(true);
  });

  it('rejects a live key before opening any proxy connection', () => {
    expect(() => createStripeClient('sk_live_forbidden')).toThrow('loopback endpoint and a test key');
    expect(destinations).toHaveLength(0);
  });
});
