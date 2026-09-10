/**
 * Failure-mapping contract for the Hudu asset importer.
 *
 * `fetchFailure` turns a company-data fetch outcome into the typed failure the
 * UI branches on: a rate-limited run must be retryable, an unmapped client must
 * point the operator at the mapping screen, and everything else must stay a
 * plain fetch failure rather than being mistaken for either.
 */

import { describe, expect, it } from 'vitest';
import { fetchFailure } from '../../lib/integrations/hudu/assetImportCore';

describe('fetchFailure', () => {
  it('reports an unmapped client with its own code and a directive message', () => {
    const failure = fetchFailure({ state: 'unmapped' } as any);

    expect(failure).toEqual({
      success: false,
      error: 'Client is not mapped to a Hudu company.',
      code: 'client_not_mapped',
    });
  });

  it('marks a rate-limited fetch so the caller can back off and retry', () => {
    const failure = fetchFailure({
      state: 'error',
      error: 'Too many requests',
      errorKind: 'rate_limited',
    } as any);

    expect(failure).toMatchObject({
      success: false,
      error: 'Too many requests',
      code: 'rate_limited',
      errorKind: 'rate_limited',
    });
  });

  it('treats any other error kind as a plain fetch failure', () => {
    const failure = fetchFailure({
      state: 'error',
      error: 'Upstream exploded',
      errorKind: 'server_error',
    } as any);

    expect(failure).toMatchObject({
      success: false,
      error: 'Upstream exploded',
      code: 'fetch_failed',
      errorKind: 'server_error',
    });
  });

  it('omits errorKind entirely when the fetch did not supply one', () => {
    const failure = fetchFailure({ state: 'error', error: 'Unknown' } as any);

    expect(failure).toEqual({
      success: false,
      error: 'Unknown',
      code: 'fetch_failed',
    });
    expect('errorKind' in failure).toBe(false);
  });

  it('carries a non-error state through as the message itself', () => {
    // `no_password_access` has no error string of its own; surfacing the state
    // keeps the reason visible instead of reporting an empty failure.
    const failure = fetchFailure({ state: 'no_password_access' } as any);

    expect(failure).toEqual({
      success: false,
      error: 'no_password_access',
      code: 'fetch_failed',
    });
  });

  it('always reports failure, never a partial success', () => {
    const states = [
      { state: 'unmapped' },
      { state: 'no_password_access' },
      { state: 'error', error: 'x' },
      { state: 'error', error: 'y', errorKind: 'rate_limited' },
    ];

    for (const state of states) {
      expect(fetchFailure(state as any).success, `state: ${state.state}`).toBe(false);
    }
  });
});
