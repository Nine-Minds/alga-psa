import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  currentUser: vi.fn(), approve: vi.fn(), approveContact: vi.fn(), contactPending: false,
  payloadState: 'pending' as string, updatedAt: new Date(),
}));
vi.mock('@alga-psa/user-composition/actions', () => ({ getCurrentUser: mocks.currentUser }));
vi.mock('@alga-psa/co-managed/deliveryRegistration', () => ({}));
vi.mock('@alga-psa/co-managed/inboundSenderConfirmation', () => ({
  parseInboundSenderConfirmationToken: (token: string) => token === 'valid-token'
    ? { tenant: 'tenant-1', sourceId: '00000000-0000-4000-8000-000000000001', expiresAt: '2030-01-01T00:00:00.000Z' }
    : null,
  isInboundSenderConfirmationRedeemable: (state: string, updatedAt: Date) => state === 'pending'
    || (state === 'redeeming' && Date.now() - updatedAt.getTime() > 60_000),
  approveInboundSenderConfirmation: mocks.approve,
  approveInboundContactSenderConfirmation: mocks.approveContact,
  loadInboundContactConfirmation: vi.fn(async () => mocks.contactPending ? ({
    row: { recipient: 'rita@example.test' },
    payload: { ticketId: 'ticket-contact', emailData: { body: { text: 'contact reply text' } } },
  }) : null),
}));
vi.mock('@alga-psa/db', () => ({
  getAdminConnection: async () => ({}),
  tenantDb: () => ({ table: () => ({ where: () => ({ first: async () => ({
    recipient: 'alice@example.test',
    payload: { expiresAt: '2030-01-01T00:00:00.000Z', state: mocks.payloadState, actor: { tenant: 'tenant-1', userId: 'alice' }, ticketId: 'ticket-1', text: 'reply', },
    updated_at: mocks.updatedAt,
  }) }) }) }),
}));

import { GET, POST } from './route';

describe('inbound sender confirmation HTTP boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('NEXTAUTH_URL', 'https://psa.example.test');
    delete process.env.APP_BASE_URL;
    mocks.payloadState = 'pending';
    mocks.contactPending = false;
    mocks.updatedAt = new Date();
    mocks.currentUser.mockResolvedValue({ tenant: 'tenant-1', user_id: 'alice', user_type: 'internal', email: 'alice@example.test' });
    mocks.approve.mockResolvedValue({ ticketId: 'ticket-1', commentId: 'comment-1' });
  });

  it('requires the intended authenticated internal user for the confirmation page', async () => {
    mocks.currentUser.mockResolvedValueOnce(null);
    const response = await GET(new NextRequest('http://0.0.0.0:3101/api/co-managed/inbound-confirmation?token=valid-token&callbackUrl=https%3A%2F%2Fattacker.example.test%2F', {
      headers: { host: 'attacker.example.test', 'x-forwarded-host': 'attacker.example.test', 'x-forwarded-proto': 'http' },
    }));
    expect(response.status).toBe(200);
    const anonymousHtml = await response.text();
    expect(anonymousHtml).toContain('Sign in as the intended internal user');
    expect(mocks.approve).not.toHaveBeenCalled();
    const signInHref = anonymousHtml.match(/href="([^"]+)"/)?.[1];
    expect(signInHref).toBeTruthy();
    const signIn = new URL(signInHref!);
    expect(signIn.pathname).toBe('/auth/msp/signin');
    const returnedUrl = new URL(signIn.searchParams.get('callbackUrl')!);
    expect(returnedUrl.origin).toBe('https://psa.example.test');
    expect(returnedUrl.pathname).toBe('/api/co-managed/inbound-confirmation');
    expect(returnedUrl.searchParams.get('token')).toBe('valid-token');
    expect(returnedUrl.searchParams.get('callbackUrl')).toBe('https://attacker.example.test/');

    // Simulate the authenticated return from sign-in: the original callback
    // URL must reopen the confirmation page and allow its guarded POST.
    const returned = await GET(new NextRequest(returnedUrl.toString()));
    expect(returned.status).toBe(200);
    expect(returned.headers.get('Referrer-Policy')).toBe('origin');
    expect(await returned.text()).toContain('<meta name="referrer" content="origin">');
    const approval = await POST(new NextRequest(returnedUrl.toString(), {
      method: 'POST', headers: { origin: 'https://psa.example.test', 'content-type': 'application/x-www-form-urlencoded' },
      body: 'token=valid-token',
    }));
    expect(approval.status).toBe(200);
    expect(mocks.approve).toHaveBeenCalledTimes(1);

    mocks.currentUser.mockResolvedValueOnce({ tenant: 'tenant-2', user_id: 'alice', user_type: 'internal', email: 'alice@example.test' });
    const wrongActor = await GET(new NextRequest('https://psa.example.test/api/co-managed/inbound-confirmation?token=valid-token'));
    expect(wrongActor.status).toBe(403);
  });

  it('rejects cross-origin POSTs and writes only for a same-origin authenticated confirmation', async () => {
    const crossOrigin = await POST(new NextRequest('https://psa.example.test/api/co-managed/inbound-confirmation', {
      method: 'POST', headers: { origin: 'https://attacker.example.test', 'content-type': 'application/x-www-form-urlencoded' },
      body: 'token=valid-token',
    }));
    expect(crossOrigin.status).toBe(403);
    expect(mocks.approve).not.toHaveBeenCalled();

    mocks.currentUser.mockResolvedValueOnce(null);
    const anonymous = await POST(new NextRequest('https://psa.example.test/api/co-managed/inbound-confirmation', {
      method: 'POST', headers: { origin: 'https://psa.example.test', 'content-type': 'application/x-www-form-urlencoded' },
      body: 'token=valid-token',
    }));
    expect(anonymous.status).toBe(403);
    expect(mocks.approve).not.toHaveBeenCalled();

    const accepted = await POST(new NextRequest('http://0.0.0.0:3101/api/co-managed/inbound-confirmation', {
      method: 'POST', headers: { origin: 'https://psa.example.test', host: 'attacker.example.test', 'x-forwarded-host': 'attacker.example.test', 'x-forwarded-proto': 'http', 'content-type': 'application/x-www-form-urlencoded' },
      body: 'token=valid-token',
    }));
    expect(accepted.status).toBe(200);
    expect(mocks.approve).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['missing', undefined],
    ['opaque null', 'null'],
    ['malformed', 'https://psa.example.test/path'],
    ['untrusted', 'https://attacker.example.test'],
  ])('denies %s origins without reaching approval', async (_name, origin) => {
    const request = new NextRequest('http://0.0.0.0:3101/api/co-managed/inbound-confirmation', {
      method: 'POST',
      headers: { ...(origin ? { origin } : {}), 'content-type': 'application/x-www-form-urlencoded', host: 'attacker.example.test', 'x-forwarded-host': 'attacker.example.test', 'x-forwarded-proto': 'https' },
      body: 'token=valid-token',
    });
    const response = await POST(request);
    expect(response.status).toBe(403);
    expect(mocks.approve).not.toHaveBeenCalled();
  });

  it('denies when no trusted public origin is configured', async () => {
    vi.stubEnv('NEXTAUTH_URL', 'not a URL');
    const response = await POST(new NextRequest('https://psa.example.test/api/co-managed/inbound-confirmation', {
      method: 'POST', headers: { origin: 'https://psa.example.test', 'content-type': 'application/x-www-form-urlencoded' }, body: 'token=valid-token',
    }));
    expect(response.status).toBe(403);
    expect(mocks.approve).not.toHaveBeenCalled();
  });

  it('shows a stale interrupted redemption for retry but hides an active claim', async () => {
    mocks.payloadState = 'redeeming';
    mocks.updatedAt = new Date(Date.now() - 61_000);
    const stale = await GET(new NextRequest('https://psa.example.test/api/co-managed/inbound-confirmation?token=valid-token'));
    expect(stale.status).toBe(200);
    expect(await stale.text()).toContain('Confirm reply');

    mocks.updatedAt = new Date();
    const active = await GET(new NextRequest('https://psa.example.test/api/co-managed/inbound-confirmation?token=valid-token'));
    expect(active.status).toBe(403);
  });

  it('renders and accepts anonymous mailbox-possession confirmation with same-origin protection', async () => {
    mocks.contactPending = true;
    mocks.approveContact.mockResolvedValue({ outcome: 'replied', ticketId: 'ticket-contact', commentId: 'comment-contact' });
    const url = 'https://psa.example.test/api/co-managed/inbound-confirmation?token=valid-token';
    const page = await GET(new NextRequest(url));
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('contact reply text');
    expect(mocks.currentUser).not.toHaveBeenCalled();

    const crossOrigin = await POST(new NextRequest('https://psa.example.test/api/co-managed/inbound-confirmation', {
      method: 'POST', headers: { origin: 'https://attacker.example.test', 'content-type': 'application/x-www-form-urlencoded' }, body: 'token=valid-token',
    }));
    expect(crossOrigin.status).toBe(403);
    expect(mocks.approveContact).not.toHaveBeenCalled();
    const approved = await POST(new NextRequest('https://psa.example.test/api/co-managed/inbound-confirmation', {
      method: 'POST', headers: { origin: 'https://psa.example.test', 'content-type': 'application/x-www-form-urlencoded' }, body: 'token=valid-token',
    }));
    expect(approved.status).toBe(200);
    expect(mocks.approveContact).toHaveBeenCalledTimes(1);
    expect(mocks.currentUser).not.toHaveBeenCalled();
  });
});
