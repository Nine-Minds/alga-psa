import { describe, expect, it } from 'vitest';

import {
  buildSsoRedirectUriState,
  confirmAllRequired,
  detectConfiguredSsoProviders,
  evaluateSsoRedirectUriGate,
  withSsoRedirectUriState,
} from 'server/src/lib/portal-domains/ssoRedirectUris';

const GOOGLE_ENV = { GOOGLE_OAUTH_CLIENT_ID: 'id', GOOGLE_OAUTH_CLIENT_SECRET: 's' };
const BOTH_ENV = { ...GOOGLE_ENV, MICROSOFT_OAUTH_CLIENT_ID: 'id', MICROSOFT_OAUTH_CLIENT_SECRET: 's' };

describe('SSO redirect URI gate (D3)', () => {
  it('detects platform providers from env', () => {
    expect(detectConfiguredSsoProviders({})).toEqual([]);
    expect(detectConfiguredSsoProviders(BOTH_ENV)).toEqual(['google', 'azure-ad']);
  });

  it('never gates a client_portal-only domain', () => {
    expect(buildSsoRedirectUriState({ domain: 'portal.pbnj.ca', surface: 'client_portal', env: BOTH_ENV })).toBeNull();
    expect(evaluateSsoRedirectUriGate('client_portal', {})).toEqual({ ok: true, missing: [] });
  });

  it('requires redirect URIs for msp/both and refuses to activate while unconfirmed', () => {
    const state = buildSsoRedirectUriState({ domain: 'helpdesk.pbnj.ca', surface: 'msp', env: BOTH_ENV })!;
    expect(state.required).toEqual([
      'https://helpdesk.pbnj.ca/api/auth/callback/azure-ad',
      'https://helpdesk.pbnj.ca/api/auth/callback/google',
    ]);
    const gate = evaluateSsoRedirectUriGate('msp', withSsoRedirectUriState({}, state));
    expect(gate.ok).toBe(false);
    expect(gate.missing).toEqual(state.required);
    expect(evaluateSsoRedirectUriGate('both', withSsoRedirectUriState({}, state)).ok).toBe(false);
  });

  it('does not activate on missing information (no state recorded)', () => {
    expect(evaluateSsoRedirectUriGate('msp', {}).ok).toBe(false);
  });

  it('passes when no SSO providers are configured (nothing to register)', () => {
    const state = buildSsoRedirectUriState({ domain: 'helpdesk.pbnj.ca', surface: 'both', env: {} })!;
    expect(state).toMatchObject({ required: [], source: 'not_required' });
    expect(evaluateSsoRedirectUriGate('both', withSsoRedirectUriState({}, state)).ok).toBe(true);
  });

  it('passes after an operator confirms, and a domain change invalidates the confirmation', () => {
    const state = buildSsoRedirectUriState({ domain: 'helpdesk.pbnj.ca', surface: 'msp', env: GOOGLE_ENV })!;
    const confirmed = confirmAllRequired(state, new Date('2026-10-21T00:00:00Z'));
    expect(evaluateSsoRedirectUriGate('msp', withSsoRedirectUriState({}, confirmed)).ok).toBe(true);

    const moved = buildSsoRedirectUriState({ domain: 'help.pbnj.ca', surface: 'msp', previous: confirmed, env: GOOGLE_ENV })!;
    expect(moved.confirmed).toEqual([]);
    expect(evaluateSsoRedirectUriGate('msp', withSsoRedirectUriState({}, moved)).ok).toBe(false);
  });

  it('counts operator-declared pre-registration as automatic confirmation', () => {
    const state = buildSsoRedirectUriState({
      domain: 'helpdesk.pbnj.ca',
      surface: 'msp',
      env: { ...GOOGLE_ENV, PORTAL_DOMAIN_SSO_REDIRECT_URIS_PREREGISTERED: 'true' },
    })!;
    expect(state.source).toBe('automation');
    expect(evaluateSsoRedirectUriGate('msp', withSsoRedirectUriState({}, state)).ok).toBe(true);
  });
});
