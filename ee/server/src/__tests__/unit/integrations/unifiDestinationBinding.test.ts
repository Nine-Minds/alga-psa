import { describe, expect, it, vi } from 'vitest';

vi.mock('@alga-psa/core/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { DESTINATION_CHANGE_NEEDS_KEY, decideDestination } from '../../../lib/integrations/unifi/credentials/destinationBinding';
import { verifyKey } from '../../../lib/integrations/unifi/credentials/credentialService';

const STORED_LOCAL = { mode: 'local' as const, localBaseUrl: 'https://10.0.0.5' };
const STORED_CLOUD = { mode: 'site_manager' as const, localBaseUrl: null };

describe('decideDestination: a stored key only goes to the destination it was saved with (T009)', () => {
  it('rejects a new controller URL without a new key', () => {
    const decision = decideDestination({
      stored: STORED_LOCAL,
      request: { mode: 'local', localBaseUrl: 'https://attacker.example' },
    });
    expect(decision).toEqual({ ok: false, error: DESTINATION_CHANGE_NEEDS_KEY });
  });

  it('rejects a mode change without a new key, in both directions', () => {
    expect(decideDestination({ stored: STORED_CLOUD, request: { mode: 'local', localBaseUrl: 'https://10.0.0.9' } })).toEqual({
      ok: false,
      error: DESTINATION_CHANGE_NEEDS_KEY,
    });
    expect(decideDestination({ stored: STORED_LOCAL, request: { mode: 'site_manager' } })).toEqual({
      ok: false,
      error: DESTINATION_CHANGE_NEEDS_KEY,
    });
  });

  it('rejects local mode with no URL when the stored key was saved for Site Manager', () => {
    const decision = decideDestination({ stored: STORED_CLOUD, request: { mode: 'local' } });
    expect(decision.ok).toBe(false);
  });

  it('allows the stored key for the unchanged destination (URL spelled differently)', () => {
    const decision = decideDestination({
      stored: STORED_LOCAL,
      request: { mode: 'local', localBaseUrl: 'https://10.0.0.5/some/path?x=1' },
    });
    expect(decision).toEqual({ ok: true, keySource: 'stored', destination: STORED_LOCAL });
  });

  it('allows the stored key when nothing about the destination is supplied', () => {
    expect(decideDestination({ stored: STORED_LOCAL, request: { mode: 'local' } })).toMatchObject({ ok: true, keySource: 'stored' });
    expect(decideDestination({ stored: STORED_CLOUD, request: { mode: 'site_manager' } })).toMatchObject({ ok: true, keySource: 'stored' });
  });

  it('allows a new destination when a new key accompanies it', () => {
    const decision = decideDestination({
      stored: STORED_LOCAL,
      request: { mode: 'local', localBaseUrl: 'https://10.0.0.9', apiKey: ' fresh ' },
    });
    expect(decision).toEqual({ ok: true, keySource: 'new', destination: { mode: 'local', localBaseUrl: 'https://10.0.0.9' } });
  });

  it('requires a key when nothing is stored, and a URL for local mode', () => {
    expect(decideDestination({ stored: null, request: { mode: 'site_manager' } })).toMatchObject({ ok: false });
    expect(decideDestination({ stored: null, request: { mode: 'local', apiKey: 'k' } })).toMatchObject({ ok: false });
  });

  it('still rejects loopback / metadata targets even with a new key', () => {
    const decision = decideDestination({
      stored: null,
      request: { mode: 'local', localBaseUrl: 'http://169.254.169.254', apiKey: 'k' },
    });
    expect(decision.ok).toBe(false);
  });

  it('issues no request at all for a rejected change: the verifier is never reached', async () => {
    const calls: Array<{ apiKey: string; localBaseUrl?: string }> = [];
    const factory = (opts: { apiKey: string; mode: any; localBaseUrl?: string }) => {
      calls.push({ apiKey: opts.apiKey, localBaseUrl: opts.localBaseUrl });
      return { testConnection: async () => undefined };
    };
    const decision = decideDestination({
      stored: STORED_LOCAL,
      request: { mode: 'local', localBaseUrl: 'https://attacker.example' },
    });
    // Callers only verify after an ok decision; encode that contract here.
    if (decision.ok) await verifyKey({ apiKey: 'stored-key', destination: decision.destination, clientFactory: factory });
    expect(calls).toEqual([]);

    const allowed = decideDestination({
      stored: STORED_LOCAL,
      request: { mode: 'local', localBaseUrl: 'https://attacker.example', apiKey: 'new-key' },
    });
    if (allowed.ok) await verifyKey({ apiKey: 'new-key', destination: allowed.destination, clientFactory: factory });
    // The only request carries the NEW key to the NEW host; the stored key never leaves.
    expect(calls).toEqual([{ apiKey: 'new-key', localBaseUrl: 'https://attacker.example' }]);
  });
});
