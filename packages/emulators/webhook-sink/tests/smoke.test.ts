import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EmulatorHost } from '@alga-psa/emulator-host';
import webhookSink from '../src/index';

let host: EmulatorHost;
let base: string;
let control: string;

beforeAll(async () => {
  host = new EmulatorHost({ emulators: [webhookSink], controlPort: 0, ports: { 'webhook-sink': 0 } });
  const { controlPort, ports } = await host.start();
  base = `http://127.0.0.1:${ports['webhook-sink']}`;
  control = `http://127.0.0.1:${controlPort}`;
});

afterAll(async () => {
  await host.stop();
});

describe('webhook sink', () => {
  it('records requests and answers 200 by default', async () => {
    const response = await fetch(`${base}/hooks/alga?source=test`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-signature': 'sig' },
      body: JSON.stringify({ event: 'ticket.created' }),
    });
    expect(response.status).toBe(200);

    const state = (await (await fetch(`${control}/control/webhook-sink/state/requests`)).json()) as any;
    expect(state.result).toHaveLength(1);
    expect(state.result[0]).toMatchObject({
      method: 'POST',
      path: '/hooks/alga',
      query: { source: 'test' },
      body: { event: 'ticket.created' },
    });
    expect(state.result[0].headers['x-signature']).toBe('sig');
  });

  it('echoes Graph validation tokens as text', async () => {
    const response = await fetch(`${base}/webhook?validationToken=tok-123`, { method: 'POST' });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/plain');
    expect(await response.text()).toBe('tok-123');
  });

  it('serves an armed custom response, then clears', async () => {
    await fetch(`${control}/control/webhook-sink/faults/custom-response/arm`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: 410, body: { gone: true } }),
    });
    const response = await fetch(`${base}/hooks/alga`, { method: 'POST' });
    expect(response.status).toBe(410);
    expect(await response.json()).toEqual({ gone: true });

    await fetch(`${control}/control/webhook-sink/faults/custom-response/disarm`, { method: 'POST' });
    expect((await fetch(`${base}/hooks/alga`, { method: 'POST' })).status).toBe(200);

    const cleared = (await (
      await fetch(`${control}/control/webhook-sink/actions/clear`, { method: 'POST' })
    ).json()) as any;
    expect(cleared.result.dropped).toBeGreaterThan(0);
    const state = (await (await fetch(`${control}/control/webhook-sink/state/requests`)).json()) as any;
    expect(state.result).toHaveLength(0);
  });
});
