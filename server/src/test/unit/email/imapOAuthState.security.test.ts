import { describe, expect, it } from 'vitest';
import {
  decodeImapOAuthState,
  encodeImapOAuthState,
  validateState,
  type ImapOAuthState,
} from '@/utils/email/oauthHelpers';

const key = 'test-only-signing-key';
const currentState = (): ImapOAuthState => ({
  tenant: 'tenant-a',
  userId: 'user-a',
  providerId: 'provider-a',
  redirectUri: 'https://psa.example.test/api/email/oauth/imap/callback',
  timestamp: Date.now(),
  nonce: 'grant-a',
  purpose: 'reconnect',
});

describe('IMAP OAuth signed state', () => {
  it('round-trips a signed reconnect grant envelope', () => {
    const state = currentState();
    expect(decodeImapOAuthState(encodeImapOAuthState(state, key), key)).toEqual(state);
  });

  it('rejects forged, tampered, unsigned, truncated, and wrong-key state', () => {
    const encoded = encodeImapOAuthState(currentState(), key);
    const [payload, signature] = encoded.split('.');
    const changedPayload = Buffer.from(JSON.stringify({ ...currentState(), tenant: 'tenant-b' })).toString('base64url');

    expect(decodeImapOAuthState(`${changedPayload}.${signature}`, key)).toBeNull();
    expect(decodeImapOAuthState(`${payload}.AAAA`, key)).toBeNull();
    expect(decodeImapOAuthState(Buffer.from(JSON.stringify(currentState())).toString('base64'), key)).toBeNull();
    expect(decodeImapOAuthState(encoded.slice(0, -2), key)).toBeNull();
    expect(decodeImapOAuthState(encoded, 'different-key')).toBeNull();
  });

  it('fails closed without a signing key and rejects expired or future timestamps', () => {
    expect(() => encodeImapOAuthState(currentState(), null)).toThrow('OAUTH_STATE_SIGNING_KEY');
    expect(decodeImapOAuthState(encodeImapOAuthState(currentState(), key), null)).toBeNull();
    expect(validateState({ ...currentState(), timestamp: Date.now() - 11 * 60 * 1000 })).toBe(false);
    expect(validateState({ ...currentState(), timestamp: Date.now() + 60_000 })).toBe(false);
  });
});
