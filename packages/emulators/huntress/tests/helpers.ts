import { EmulatorHost } from '@alga-psa/emulator-host';
import huntress from '../src/index';
import type { HuntressEmulatorCore } from '../src/core';

export const API_KEY = 'algasim-huntress-key';
export const API_SECRET = 'algasim-huntress-secret';

/** The header Huntress documents: Basic base64(api_key:api_secret). */
export function basicAuth(key = API_KEY, secret = API_SECRET): string {
  return `Basic ${Buffer.from(`${key}:${secret}`, 'utf8').toString('base64')}`;
}

export async function startHuntress() {
  const host = new EmulatorHost({ emulators: [huntress], controlPort: 0, ports: { huntress: 0 } });
  const { controlPort, ports } = await host.start();
  const control = `http://127.0.0.1:${controlPort}`;
  const call = async (kind: 'seed' | 'actions', name: string, params: unknown = {}) => {
    const response = await fetch(`${control}/control/huntress/${kind}/${name}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(params),
    });
    const json = (await response.json()) as { ok: boolean; result?: any; error?: string };
    if (!json.ok) throw new Error(`${kind}/${name} failed: ${json.error}`);
    return json.result;
  };
  return {
    host,
    control,
    vendor: `http://127.0.0.1:${ports.huntress}`,
    core: host.instance('huntress').core as HuntressEmulatorCore,
    seed: (name: string, params?: unknown) => call('seed', name, params),
    action: (name: string, params?: unknown) => call('actions', name, params),
    arm: async (name: string, params: unknown = {}) => {
      const response = await fetch(`${control}/control/huntress/faults/${name}/arm`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(params),
      });
      if (response.status !== 200) throw new Error(`arm ${name} failed: ${await response.text()}`);
    },
    state: async (view: string) =>
      ((await (await fetch(`${control}/control/huntress/state/${view}`)).json()) as { result: any }).result,
    reset: () => fetch(`${control}/control/huntress/reset`, { method: 'POST' }),
  };
}
