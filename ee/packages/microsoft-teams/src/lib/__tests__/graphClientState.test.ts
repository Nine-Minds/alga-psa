import { describe, expect, it } from 'vitest';

import {
  assertGraphClientStateFits,
  fitsGraphClientState,
  generateGraphClientStateSecret,
  MAX_GRAPH_CLIENT_STATE_LENGTH,
} from '../graphClientState';

/**
 * Graph silently refuses a subscription whose clientState is one character over
 * the limit, so the boundary itself is the contract worth pinning.
 */
describe('fitsGraphClientState', () => {
  it('accepts a clientState exactly at the Graph limit', () => {
    expect(fitsGraphClientState('a'.repeat(MAX_GRAPH_CLIENT_STATE_LENGTH))).toBe(true);
  });

  it('rejects a clientState one character over the limit', () => {
    expect(fitsGraphClientState('a'.repeat(MAX_GRAPH_CLIENT_STATE_LENGTH + 1))).toBe(false);
  });
});

describe('assertGraphClientStateFits', () => {
  it('returns the clientState unchanged when it fits', () => {
    const clientState = 'teams-online-meeting-artifacts:tenant:recordings:deadbeef';
    expect(assertGraphClientStateFits(clientState, 'Teams recordings subscription')).toBe(clientState);
  });

  it('throws with the label, the actual length and the limit', () => {
    expect(() => assertGraphClientStateFits('a'.repeat(136), 'Teams call-records subscription'))
      .toThrow(/Teams call-records subscription clientState is 136 characters; Microsoft Graph allows at most 128\./);
  });
});

describe('generateGraphClientStateSecret', () => {
  it('generates a 32-character hex secret', () => {
    expect(generateGraphClientStateSecret()).toMatch(/^[0-9a-f]{32}$/);
  });
});
