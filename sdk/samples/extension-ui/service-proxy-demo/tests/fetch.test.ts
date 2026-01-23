import { describe, expect, it } from 'vitest';
import { fetchTicketsViaProxy, TicketProxyResponse } from '../src/tickets-panel.js';
import type { UiProxyHost } from '@alga-psa/extension-runtime';

const encoder = new TextEncoder();

function createUiProxy(response: TicketProxyResponse): UiProxyHost {
  const handler = async (route: string, payload?: Uint8Array | null) => {
    expect(route).toBe('/tickets/list');
    if (payload) {
      const decoded = JSON.parse(new TextDecoder().decode(payload));
      expect(decoded.limit).toBe(5);
    }
    return encoder.encode(JSON.stringify(response));
  };
  return {
    callRoute: handler,
    call: handler,
  };
}

describe('fetchTicketsViaProxy', () => {
  it('returns the parsed ticket list', async () => {
    const response = await fetchTicketsViaProxy(
      createUiProxy({ ok: true, tickets: [{ id: 'T-1', title: 'Demo', status: 'open' }] }),
      5,
    );
    expect(response.ok).toBe(true);
    expect(response.tickets).toHaveLength(1);
  });
});
