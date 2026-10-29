import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import vm from 'node:vm';
import { NextRequest } from 'next/server';
import { PROVIDER_SETUP_ENTRY_PATH, resolveProductNavDestination } from '@alga-psa/types';

const hoisted = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  getSigningSecret: vi.fn(),
  validateState: vi.fn(),
  consumeState: vi.fn(),
  complete: vi.fn(),
  recordConsent: vi.fn(),
  realValidate: null as null | ((input: any) => unknown),
  product: 'psa' as string,
}));

vi.mock('@alga-psa/user-composition/actions', () => ({
  getCurrentUser: (...args: unknown[]) => hoisted.getCurrentUser(...args),
}));

vi.mock('@alga-psa/integrations/actions/integrations/microsoftEmailSetupActions', () => ({
  getMicrosoftEmailSetupSigningSecret: (...args: unknown[]) => hoisted.getSigningSecret(...args),
  completeMicrosoftEmailApplicationCreation: (...args: unknown[]) => hoisted.complete(...args),
}));

vi.mock('@alga-psa/integrations/lib/microsoftEmailAdminConsent', () => ({
  recordMicrosoftEmailAdminConsentFromState: (...args: unknown[]) => hoisted.recordConsent(...args),
}));

vi.mock('@alga-psa/integrations/lib/microsoftEmailSetup', async (importOriginal) => {
  const original = await importOriginal<typeof import('@alga-psa/integrations/lib/microsoftEmailSetup')>();
  hoisted.realValidate = original.validateMicrosoftEmailSetupState;
  return {
    ...original,
    validateMicrosoftEmailSetupState: (...args: unknown[]) => hoisted.validateState(...args),
  };
});

vi.mock('@alga-psa/integrations/utils/microsoftEmailSetupStateStore', () => ({
  consumeMicrosoftEmailSetupState: (...args: unknown[]) => hoisted.consumeState(...args),
}));

vi.mock('@/lib/productAccess', () => ({
  getCurrentTenantProduct: vi.fn(async () => hoisted.product),
}));
import { GET as dispatchProductNav } from '../../../app/msp/go/[target]/route';
import { createMicrosoftEmailSetupState } from '@alga-psa/integrations/lib/microsoftEmailSetup';
const realValidateState = (input: any) => hoisted.realValidate!(input) as ReturnType<typeof import('@alga-psa/integrations/lib/microsoftEmailSetup').validateMicrosoftEmailSetupState>;
import { GET } from '../../../app/api/auth/microsoft/email-setup/callback/route';

/**
 * The route base64s a percent-encoded JSON payload (so accented Microsoft error
 * text survives the popup's latin-1 `atob`), and the first `atob(...)` literal
 * in the page is always the postMessage payload.
 */
function readPayload(html: string): string {
  return decodeURIComponent(
    Buffer.from(html.match(/atob\('([^']+)'\)/)?.[1] || '', 'base64').toString(),
  );
}

function allAtobLiterals(html: string): string[] {
  return [...html.matchAll(/atob\('([^']+)'\)/g)].map((m) => Buffer.from(m[1], 'base64').toString());
}

/** Runs the page's inline script against a fake window so the real branch logic executes. */
function runPageScript(html: string, opener: { postMessage: (...a: unknown[]) => void } | null) {
  const script = html.match(/<script>([\s\S]*?)<\/script>/)![1];
  const replace = vi.fn();
  const sandbox = {
    window: { opener, location: { replace }, close: vi.fn(), closed: false },
    document: {
      getElementById: () => ({ textContent: '' }),
      createElement: () => ({}),
      body: { appendChild: vi.fn() },
    },
    atob: (v: string) => Buffer.from(v, 'base64').toString('latin1'),
    JSON,
    decodeURIComponent,
    setTimeout: () => 0,
  };
  vm.runInNewContext(script, sandbox);
  return { replace };
}

const adminConsentState = {
  purpose: 'admin_consent' as const,
  algaTenant: 'alga-tenant-1',
  userId: 'user-1',
  returnTo: 'https://psa.example.com/msp/settings/integrations?category=providers',
  nonce: 'consent-nonce',
  clientId: 'email-client-id',
  profileId: 'profile-1',
  issuedAt: 1,
  expiresAt: 2,
};

const createState = {
  purpose: 'create_application' as const,
  algaTenant: 'alga-tenant-1',
  userId: 'user-1',
  returnTo: 'https://psa.example.com/msp/settings/integrations?category=providers',
  nonce: 'state-nonce',
  oauthNonce: 'oauth-nonce',
  issuedAt: 1,
  expiresAt: 2,
};

describe('Microsoft email setup callback', () => {
  beforeEach(() => {
    hoisted.getSigningSecret.mockReset().mockResolvedValue('signing-secret');
    hoisted.validateState.mockReset().mockReturnValue(createState);
    hoisted.getCurrentUser.mockReset().mockResolvedValue({
      tenant: 'alga-tenant-1',
      user_id: 'user-1',
    });
    hoisted.consumeState.mockReset().mockResolvedValue({ verifier: 'one-time-verifier' });
    hoisted.complete.mockReset().mockResolvedValue({ success: true, profileId: 'profile-1' });
    hoisted.recordConsent.mockReset().mockResolvedValue({ success: true, profileId: 'profile-1' });
  });

  it('returns invalid setup attempts to the Providers integration route', async () => {
    const originalBaseUrl = process.env.NEXT_PUBLIC_BASE_URL;
    process.env.NEXT_PUBLIC_BASE_URL = 'https://psa.example.com';
    hoisted.validateState.mockReturnValue(null);
    try {
      const response = await GET(new NextRequest(
        'https://psa.example.com/api/auth/microsoft/email-setup/callback?state=invalid'
      ));
      const html = await response.text();

      // This assertion used to name the PSA integrations URL directly. Since
      // the product-neutral dispatcher landed, the contract it protected -- a
      // PSA tenant that abandons provider setup lands on the PSA Providers
      // page -- is split across two places, so both halves are asserted here.
      //
      // Half 1: the callback emits the dispatcher link, not a product-specific
      // URL, so a co-managed tenant is never handed a PSA page.
      expect(html).toContain(Buffer.from(
        `https://psa.example.com${PROVIDER_SETUP_ENTRY_PATH}`
      ).toString('base64'));
      // Half 2: the dispatcher resolves that link back to the PSA Providers
      // page for a PSA tenant. Deleting the psa row from
      // PRODUCT_NAV_DESTINATIONS turns this red.
      expect(resolveProductNavDestination('providers', 'psa')).toBe(
        '/msp/settings/integrations?category=providers'
      );
      expect(html).not.toContain(Buffer.from(
        'https://psa.example.com/msp/settings?category=providers'
      ).toString('base64'));
    } finally {
      if (originalBaseUrl === undefined) delete process.env.NEXT_PUBLIC_BASE_URL;
      else process.env.NEXT_PUBLIC_BASE_URL = originalBaseUrl;
    }
  });

  it('consumes the one-time verifier when Microsoft consent is denied', async () => {
    const response = await GET(new NextRequest(
      'https://psa.example.com/api/auth/microsoft/email-setup/callback?error=access_denied&state=signed-state'
    ));
    const html = await response.text();

    expect(hoisted.consumeState).toHaveBeenCalledWith('state-nonce');
    expect(hoisted.complete).not.toHaveBeenCalled();
    expect(html).toContain('Microsoft Email Setup');
    expect(JSON.parse(readPayload(html))).toMatchObject({
      success: false,
      errorCode: 'consent_denied',
      error: expect.stringContaining('Microsoft sign-in or administrator consent was denied'),
    });
  });

  it('rejects a state/session tenant mismatch and consumes creation state', async () => {
    hoisted.getCurrentUser.mockResolvedValue({ tenant: 'another-tenant', user_id: 'user-1' });
    const response = await GET(new NextRequest(
      'https://psa.example.com/api/auth/microsoft/email-setup/callback?code=code&state=signed-state'
    ));
    const html = await response.text();

    expect(hoisted.consumeState).toHaveBeenCalledWith('state-nonce');
    expect(hoisted.complete).not.toHaveBeenCalled();
    expect(JSON.parse(readPayload(html))).toMatchObject({
      success: false,
      errorCode: 'session_mismatch',
      error: expect.stringContaining('different browser or a private window'),
    });
  });

  it('delegates a valid code to provisioning without exposing setup tokens', async () => {
    const response = await GET(new NextRequest(
      'https://psa.example.com/api/auth/microsoft/email-setup/callback?code=authorization-code&state=signed-state'
    ));
    const html = await response.text();

    expect(hoisted.complete).toHaveBeenCalledWith({
      user: { tenant: 'alga-tenant-1', user_id: 'user-1' },
      state: createState,
      code: 'authorization-code',
    });
    expect(readPayload(html)).toContain('profile-1');
    expect(html).not.toContain('access_token');
    expect(html).not.toContain('one-time-verifier');
  });

  it('persists administrator consent before reporting setup completion', async () => {
    hoisted.validateState.mockReturnValue({
      ...createState,
      purpose: 'admin_consent',
      clientId: 'email-client-id',
      profileId: 'profile-1',
      oauthNonce: undefined,
    });

    const response = await GET(new NextRequest(
      'https://psa.example.com/api/auth/microsoft/email-setup/callback?admin_consent=true&tenant=microsoft-tenant&state=signed-state'
    ));
    const html = await response.text();

    expect(hoisted.recordConsent).toHaveBeenCalledWith({
      algaTenant: 'alga-tenant-1',
      profileId: 'profile-1',
      clientId: 'email-client-id',
      microsoftTenantId: 'microsoft-tenant',
    });
    expect(readPayload(html)).toContain('admin_consent');
  });

  it('does not advance setup when consent persistence fails', async () => {
    hoisted.validateState.mockReturnValue({
      ...createState,
      purpose: 'admin_consent',
      clientId: 'email-client-id',
      profileId: 'profile-1',
      oauthNonce: undefined,
    });
    hoisted.recordConsent.mockResolvedValue({ success: false, error: 'Database unavailable' });

    const response = await GET(new NextRequest(
      'https://psa.example.com/api/auth/microsoft/email-setup/callback?admin_consent=true&tenant=microsoft-tenant&state=signed-state'
    ));
    const html = await response.text();

    expect(JSON.parse(readPayload(html))).toMatchObject({
      success: false,
      errorCode: 'consent_persist_failed',
      error: 'Database unavailable',
    });
    expect(readPayload(html)).not.toContain('"stage"');
    expect(readPayload(html)).not.toContain('admin_consent');
  });

  it('reports failures as stable codes rather than user-facing prose', async () => {
    hoisted.validateState.mockReturnValue(null);
    const invalid = await GET(new NextRequest(
      'https://psa.example.com/api/auth/microsoft/email-setup/callback?state=invalid'
    ));
    expect(JSON.parse(readPayload(await invalid.text()))).toMatchObject({
      success: false,
      errorCode: 'invalid_state',
    });

    hoisted.validateState.mockReturnValue(createState);
    const noCode = await GET(new NextRequest(
      'https://psa.example.com/api/auth/microsoft/email-setup/callback?state=signed-state'
    ));
    expect(JSON.parse(readPayload(await noCode.text()))).toMatchObject({
      success: false,
      errorCode: 'missing_code',
    });

    const unknownMicrosoftError = await GET(new NextRequest(
      'https://psa.example.com/api/auth/microsoft/email-setup/callback?error=server_error&state=signed-state'
    ));
    expect(JSON.parse(readPayload(await unknownMicrosoftError.text()))).toMatchObject({
      success: false,
      errorCode: 'microsoft_error',
    });

    hoisted.validateState.mockReturnValue({
      ...createState,
      purpose: 'admin_consent',
      clientId: 'email-client-id',
      profileId: 'profile-1',
      oauthNonce: undefined,
    });
    const declined = await GET(new NextRequest(
      'https://psa.example.com/api/auth/microsoft/email-setup/callback?admin_consent=false&state=signed-state'
    ));
    expect(JSON.parse(readPayload(await declined.text()))).toMatchObject({
      success: false,
      errorCode: 'consent_not_granted',
    });
  });

  describe('admin_consent from a copied approval link', () => {
    beforeEach(() => {
      hoisted.validateState.mockReturnValue(adminConsentState);
      hoisted.recordConsent.mockResolvedValue({ success: true, profileId: 'profile-1' });
    });

    const consentUrl =
      'https://psa.example.com/api/auth/microsoft/email-setup/callback?admin_consent=True&tenant=microsoft-tenant&state=signed-state';

    it('records consent with no Alga session and does not report session_mismatch', async () => {
      hoisted.getCurrentUser.mockResolvedValue(null);
      const html = await (await GET(new NextRequest(consentUrl))).text();

      expect(hoisted.getCurrentUser).not.toHaveBeenCalled();
      expect(hoisted.recordConsent).toHaveBeenCalledTimes(1);
      expect(hoisted.recordConsent).toHaveBeenCalledWith({
        algaTenant: 'alga-tenant-1',
        clientId: 'email-client-id',
        profileId: 'profile-1',
        microsoftTenantId: 'microsoft-tenant',
      });
      const payload = JSON.parse(readPayload(html));
      expect(payload).toMatchObject({ success: true, stage: 'admin_consent' });
      expect(payload.errorCode).toBeUndefined();
    });

    it('records consent for a different user\'s session and does not report session_mismatch', async () => {
      hoisted.getCurrentUser.mockResolvedValue({ tenant: 'someone-elses-tenant', user_id: 'user-9' });
      const html = await (await GET(new NextRequest(consentUrl))).text();

      expect(hoisted.recordConsent).toHaveBeenCalledTimes(1);
      expect(JSON.parse(readPayload(html))).toMatchObject({ success: true });
      expect(readPayload(html)).not.toContain('session_mismatch');
    });

    it('records nothing when Microsoft did not return admin_consent=True', async () => {
      const html = await (await GET(new NextRequest(
        'https://psa.example.com/api/auth/microsoft/email-setup/callback?admin_consent=false&state=signed-state'
      ))).text();
      expect(hoisted.recordConsent).not.toHaveBeenCalled();
      expect(JSON.parse(readPayload(html))).toMatchObject({ errorCode: 'consent_not_granted' });
    });

    it('is not single-use: a replay inside the TTL succeeds through the idempotent writer without consuming state', async () => {
      // Known, bounded risk (design D3): the link is reusable until it expires,
      // and the writer keeps the first grant timestamp, so a replay changes nothing.
      const first = JSON.parse(readPayload(await (await GET(new NextRequest(consentUrl))).text()));
      const second = JSON.parse(readPayload(await (await GET(new NextRequest(consentUrl))).text()));
      expect(first.success).toBe(true);
      expect(second.success).toBe(true);
      expect(hoisted.recordConsent).toHaveBeenCalledTimes(2);
      expect(hoisted.consumeState).not.toHaveBeenCalled();
    });

    it('still requires the starter session for create_application', async () => {
      hoisted.validateState.mockReturnValue(createState);
      hoisted.getCurrentUser.mockResolvedValue(null);
      const html = await (await GET(new NextRequest(
        'https://psa.example.com/api/auth/microsoft/email-setup/callback?code=c&state=signed-state'
      ))).text();
      expect(JSON.parse(readPayload(html))).toMatchObject({ errorCode: 'session_mismatch' });
      expect(hoisted.complete).not.toHaveBeenCalled();
      expect(hoisted.recordConsent).not.toHaveBeenCalled();
    });
  });

  describe('state validation with the real signer', () => {
    const secret = 'test-signing-secret';
    const mint = (opts: Partial<Parameters<typeof createMicrosoftEmailSetupState>[0]> = {}) =>
      createMicrosoftEmailSetupState({
        purpose: 'admin_consent',
        algaTenant: 'alga-tenant-1',
        userId: 'user-1',
        returnTo: 'https://psa.example.com/msp/settings/integrations?category=providers',
        secret,
        clientId: 'email-client-id',
        profileId: 'profile-1',
        ...opts,
      }).token;

    beforeEach(() => {
      hoisted.getSigningSecret.mockResolvedValue(secret);
      hoisted.validateState.mockImplementation((input: any) => realValidateState(input));
      hoisted.getCurrentUser.mockResolvedValue(null);
    });

    const hit = async (token: string) =>
      JSON.parse(readPayload(await (await GET(new NextRequest(
        `https://psa.example.com/api/auth/microsoft/email-setup/callback?admin_consent=True&tenant=t&state=${encodeURIComponent(token)}`
      ))).text()));

    it('accepts a freshly signed admin_consent state with no session', async () => {
      expect(await hit(mint())).toMatchObject({ success: true, stage: 'admin_consent' });
      expect(hoisted.recordConsent).toHaveBeenCalledTimes(1);
    });

    it('rejects an expired state and records nothing', async () => {
      expect(await hit(mint({ ttlSeconds: -120 }))).toMatchObject({ success: false, errorCode: 'invalid_state' });
      expect(hoisted.recordConsent).not.toHaveBeenCalled();
    });

    it('rejects a tampered payload and records nothing', async () => {
      const [payload, signature] = mint().split('.');
      const forged = JSON.parse(Buffer.from(payload, 'base64url').toString());
      forged.profileId = 'someone-elses-profile';
      const token = `${Buffer.from(JSON.stringify(forged)).toString('base64url')}.${signature}`;
      expect(await hit(token)).toMatchObject({ success: false, errorCode: 'invalid_state' });
      expect(hoisted.recordConsent).not.toHaveBeenCalled();
    });

    it('rejects a state signed with another secret and a missing state', async () => {
      expect(await hit(mint({ secret: 'other-secret' }))).toMatchObject({ errorCode: 'invalid_state' });
      expect(await hit('')).toMatchObject({ errorCode: 'invalid_state' });
      expect(hoisted.recordConsent).not.toHaveBeenCalled();
    });

    it('honours the purpose-specific TTL: admin_consent outlives 10 minutes, create_application does not', async () => {
      const now = Math.floor(Date.now() / 1000);
      const consent = realValidateState({ token: mint(), secret, now: now + 3600 });
      expect(consent).not.toBeNull();
      const create = createMicrosoftEmailSetupState({
        purpose: 'create_application', algaTenant: 'a', userId: 'u', secret,
        returnTo: 'https://psa.example.com/x', includeOauthNonce: true,
      }).token;
      expect(realValidateState({ token: create, secret, now: now + 3600 })).toBeNull();
      expect(realValidateState({ token: create, secret, now: now + 60 })).not.toBeNull();
    });
  });

  describe('Microsoft error outcome', () => {
    const correlationId = '0b9a1f4e-3c2d-4e5f-8a6b-7c8d9e0f1a2b';

    it('carries the code, AADSTS and correlation ID, with the sanitized description', async () => {
      hoisted.validateState.mockReturnValue(adminConsentState);
      const description = encodeURIComponent(
        `AADSTS53003: Access has been blocked by Conditional Access policies.\r\nTrace ID: x\r\nCorrelation ID: ${correlationId}`
      );
      const html = await (await GET(new NextRequest(
        `https://psa.example.com/api/auth/microsoft/email-setup/callback?error=access_denied&error_description=${description}&state=signed-state`
      ))).text();

      expect(JSON.parse(readPayload(html))).toMatchObject({
        success: false,
        errorCode: 'policy_blocked',
        aadsts: '53003',
        correlationId,
        microsoftDetail: 'AADSTS53003: Access has been blocked by Conditional Access policies.',
        error: expect.not.stringContaining('manual'),
      });
      expect(hoisted.recordConsent).not.toHaveBeenCalled();
    });

    it('does not require a session for an admin_consent Microsoft error', async () => {
      hoisted.validateState.mockReturnValue(adminConsentState);
      hoisted.getCurrentUser.mockResolvedValue(null);
      const html = await (await GET(new NextRequest(
        'https://psa.example.com/api/auth/microsoft/email-setup/callback?error=server_error&error_description=AADSTS90094%3A%20admin%20needed&state=signed-state'
      ))).text();
      expect(JSON.parse(readPayload(html))).toMatchObject({ errorCode: 'admin_required', aadsts: '90094' });
    });
  });

  describe('outcome delivery', () => {
    const consentUrl =
      'https://psa.example.com/api/auth/microsoft/email-setup/callback?admin_consent=True&tenant=microsoft-tenant&state=signed-state-token';

    it('redirects to the signed-state returnTo with the outcome params when there is no window.opener', async () => {
      hoisted.validateState.mockReturnValue({
        ...adminConsentState,
        returnTo: 'https://psa.example.com/msp/settings/integrations?category=providers',
      });
      const html = await (await GET(new NextRequest(
        'https://psa.example.com/api/auth/microsoft/email-setup/callback?error=access_denied&error_description=AADSTS53003%3A%20blocked&correlation_id=0b9a1f4e-3c2d-4e5f-8a6b-7c8d9e0f1a2b&state=signed-state-token'
      ))).text();

      const { replace } = runPageScript(html, null);
      expect(replace).toHaveBeenCalledTimes(1);
      const target = new URL(replace.mock.calls[0][0]);
      expect(target.origin + target.pathname).toBe('https://psa.example.com/msp/settings/integrations');
      expect(target.searchParams.get('category')).toBe('providers');
      expect(target.searchParams.get('microsoft_email_setup')).toBe('error');
      expect(target.searchParams.get('error_code')).toBe('policy_blocked');
      expect(target.searchParams.get('aadsts')).toBe('53003');
      expect(target.searchParams.get('correlation_id')).toBe('0b9a1f4e-3c2d-4e5f-8a6b-7c8d9e0f1a2b');
      expect(target.toString()).not.toContain('signed-state-token');
      expect(html).not.toContain('signed-state-token');
      expect(allAtobLiterals(html).join('\n')).not.toContain('signed-state-token');
    });

    it.each([
      ['psa', '/msp/settings/integrations', 'category'],
      ['co_managed', '/msp/co-management/providers', null],
    ])('the no-opener redirect survives the /msp/go dispatcher round trip (%s)', async (product, path, category) => {
      hoisted.product = product;
      hoisted.validateState.mockReturnValue({
        ...adminConsentState,
        returnTo: `https://psa.example.com${PROVIDER_SETUP_ENTRY_PATH}`,
      });
      const html = await (await GET(new NextRequest(
        'https://psa.example.com/api/auth/microsoft/email-setup/callback?error=access_denied&error_description=AADSTS53003%3A%20blocked&correlation_id=0b9a1f4e-3c2d-4e5f-8a6b-7c8d9e0f1a2b&state=signed-state-token'
      ))).text();
      const { replace } = runPageScript(html, null);
      const hop = new URL(replace.mock.calls[0][0]);
      expect(hop.pathname).toBe(PROVIDER_SETUP_ENTRY_PATH);

      const res = await dispatchProductNav(new NextRequest(hop), { params: Promise.resolve({ target: 'providers' }) });
      const landed = new URL(res.headers.get('location')!);
      expect(landed.pathname).toBe(path);
      if (category) expect(landed.searchParams.get('category')).toBe('providers');
      expect(landed.searchParams.get('microsoft_email_setup')).toBe('error');
      expect(landed.searchParams.get('error_code')).toBe('policy_blocked');
      expect(landed.searchParams.get('aadsts')).toBe('53003');
      expect(landed.searchParams.get('correlation_id')).toBe('0b9a1f4e-3c2d-4e5f-8a6b-7c8d9e0f1a2b');
    });

    it('redirects with microsoft_email_setup=ok on success and posts nothing', async () => {
      hoisted.validateState.mockReturnValue(adminConsentState);
      const html = await (await GET(new NextRequest(consentUrl))).text();
      const { replace } = runPageScript(html, null);
      const target = new URL(replace.mock.calls[0][0]);
      expect(target.searchParams.get('microsoft_email_setup')).toBe('ok');
      expect(target.searchParams.has('error_code')).toBe(false);
    });

    it('uses returnTo from the signed state, never from the query string', async () => {
      hoisted.validateState.mockReturnValue(adminConsentState);
      const html = await (await GET(new NextRequest(
        `${consentUrl}&returnTo=https%3A%2F%2Fevil.example%2F&return_to=https%3A%2F%2Fevil.example%2F`
      ))).text();
      const { replace } = runPageScript(html, null);
      expect(new URL(replace.mock.calls[0][0]).origin).toBe('https://psa.example.com');
      expect(html).not.toContain('evil.example');
    });

    it('posts to the opener, targeted at the returnTo origin, and does not redirect when one exists', async () => {
      hoisted.validateState.mockReturnValue(adminConsentState);
      const html = await (await GET(new NextRequest(consentUrl))).text();
      const postMessage = vi.fn();
      const { replace } = runPageScript(html, { postMessage });
      expect(replace).not.toHaveBeenCalled();
      expect(postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'microsoft-email-setup-callback', success: true }),
        'https://psa.example.com',
      );
    });
  });

  describe('structured logging', () => {
    let warn: ReturnType<typeof vi.spyOn>;
    let info: ReturnType<typeof vi.spyOn>;
    beforeEach(() => {
      warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      info = vi.spyOn(console, 'info').mockImplementation(() => {});
    });
    afterEach(() => {
      warn.mockRestore();
      info.mockRestore();
    });

    it('logs code, AADSTS and correlation ID for a Microsoft error and never the state token, code or raw description', async () => {
      hoisted.validateState.mockReturnValue(adminConsentState);
      await GET(new NextRequest(
        'https://psa.example.com/api/auth/microsoft/email-setup/callback?error=access_denied&error_description=AADSTS53003%3A%20secret-description-text&correlation_id=0b9a1f4e-3c2d-4e5f-8a6b-7c8d9e0f1a2b&code=AUTHCODE&state=signed-state-token'
      ));

      expect(warn).toHaveBeenCalledTimes(1);
      const [label, entry] = warn.mock.calls[0];
      expect(label).toBe('[microsoft-email-setup] callback');
      expect(entry).toEqual({
        purpose: 'admin_consent',
        outcome: 'failure',
        errorCode: 'policy_blocked',
        aadsts: '53003',
        correlationId: '0b9a1f4e-3c2d-4e5f-8a6b-7c8d9e0f1a2b',
        algaTenant: 'alga-tenant-1',
        profileId: 'profile-1',
      });
      const serialized = JSON.stringify(warn.mock.calls) + JSON.stringify(info.mock.calls);
      expect(serialized).not.toContain('signed-state-token');
      expect(serialized).not.toContain('AUTHCODE');
      expect(serialized).not.toContain('secret-description-text');
    });

    it('logs a success at info level without the state token', async () => {
      hoisted.validateState.mockReturnValue(adminConsentState);
      await GET(new NextRequest(
        'https://psa.example.com/api/auth/microsoft/email-setup/callback?admin_consent=True&tenant=t&state=signed-state-token'
      ));
      expect(info).toHaveBeenCalledTimes(1);
      expect(info.mock.calls[0][1]).toMatchObject({ purpose: 'admin_consent', outcome: 'success', errorCode: null });
      expect(JSON.stringify(info.mock.calls)).not.toContain('signed-state-token');
      expect(warn).not.toHaveBeenCalled();
    });

    it('logs invalid_state without the token', async () => {
      hoisted.validateState.mockReturnValue(null);
      await GET(new NextRequest(
        'https://psa.example.com/api/auth/microsoft/email-setup/callback?state=signed-state-token'
      ));
      expect(warn.mock.calls[0][1]).toMatchObject({ purpose: 'unknown', errorCode: 'invalid_state' });
      expect(JSON.stringify(warn.mock.calls)).not.toContain('signed-state-token');
    });
  });
});
