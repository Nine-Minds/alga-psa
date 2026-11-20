import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * The two bulk portal invitation endpoints. A batch that could not invite
 * everybody is still a 200 whose envelope names each contact's outcome; only a
 * refusal of the whole request (no targets, over the cap, no permission) is an
 * error status.
 */

const TENANT = '11111111-1111-1111-1111-111111111111';
const CLIENT = '22222222-2222-2222-2222-222222222222';
const CONTACT_A = '33333333-3333-3333-3333-333333333333';
const CONTACT_B = '44444444-4444-4444-4444-444444444444';

const state = vi.hoisted(() => ({
  calls: [] as Array<Record<string, unknown>>,
  result: null as Record<string, unknown> | null,
}));

vi.mock('@/lib/services/apiKeyServiceForApi', () => ({
  ApiKeyServiceForApi: {
    validateApiKeyAnyTenant: vi.fn(async () => ({ tenant: TENANT, user_id: 'user-1', api_key_id: 'key-1' })),
    validateApiKeyForTenant: vi.fn(async () => ({ tenant: TENANT, user_id: 'user-1', api_key_id: 'key-1' })),
  },
}));

vi.mock('@alga-psa/users/actions', () => ({
  findUserByIdForApi: vi.fn(async () => ({ user_id: 'user-1', user_type: 'internal', tenant: TENANT })),
}));

vi.mock('@/lib/db', () => ({
  runWithTenant: vi.fn(async (_tenant: string, callback: () => Promise<any>) => callback()),
  runWithApiKeyUser: vi.fn(async (_user: unknown, callback: () => Promise<any>) => callback()),
}));

vi.mock('@/lib/db/db', () => ({ getConnection: vi.fn(async () => ({})) }));

vi.mock('@/lib/auth/rbac', () => ({ hasPermission: vi.fn(async () => true) }));

vi.mock('@/lib/api/rateLimit/enforce', () => ({
  enforceApiRateLimit: vi.fn(async () => null),
  shouldBypassRateLimit: vi.fn(() => false),
}));

vi.mock('@/lib/productAccess', () => ({ getTenantProduct: vi.fn(async () => 'psa') }));
vi.mock('@/lib/productSurfaceRegistry', () => ({ resolveProductApiBehavior: vi.fn(() => 'allowed') }));

vi.mock('@alga-psa/portal-shared/actions/portalInvitationActions', () => ({
  sendBulkPortalInvitations: vi.fn(async (params: Record<string, unknown>) => {
    state.calls.push(params);
    return state.result;
  }),
}));

const { POST: postForClient } = await import('../../../app/api/v1/clients/[id]/portal-invitations/route');
const { POST: postBulk } = await import('../../../app/api/v1/portal-invitations/bulk/route');

const request = (url: string, body: unknown) =>
  new NextRequest(url, {
    method: 'POST',
    headers: { 'x-api-key': 'test-api-key', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

const clientUrl = `http://localhost/api/v1/clients/${CLIENT}/portal-invitations`;
const bulkUrl = 'http://localhost/api/v1/portal-invitations/bulk';

beforeEach(() => {
  state.calls = [];
  state.result = {
    success: true,
    total: 2,
    sent: 1,
    skipped: 1,
    failed: 0,
    results: [
      { contactId: CONTACT_A, email: 'a@acme.test', status: 'sent', invitationId: 'inv-1' },
      { contactId: CONTACT_B, status: 'skipped', errorCode: 'USER_EXISTS_FOR_CONTACT', message: 'already a user' },
    ],
  };
});

describe('POST /api/v1/clients/{id}/portal-invitations', () => {
  it('invites every eligible contact of the client and returns the per-contact envelope', async () => {
    const res = await postForClient(request(clientUrl, { all_eligible: true }));
    expect(res.status).toBe(200);

    expect(state.calls[0]).toEqual({ clientId: CLIENT, contactIds: undefined, allEligible: true });
    const body = await res.json();
    expect(body.data).toMatchObject({ total: 2, sent: 1, skipped: 1, failed: 0 });
    expect(body.data.results).toEqual([
      { contact_id: CONTACT_A, email: 'a@acme.test', status: 'sent', invitation_id: 'inv-1' },
      { contact_id: CONTACT_B, status: 'skipped', error_code: 'USER_EXISTS_FOR_CONTACT', message: 'already a user' },
    ]);
  });

  it('passes an explicit subset through with the client of the path', async () => {
    await postForClient(request(clientUrl, { contact_ids: [CONTACT_A] }));
    expect(state.calls[0]).toEqual({ clientId: CLIENT, contactIds: [CONTACT_A], allEligible: false });
  });

  it('passes an invitation-state resend through to the same action', async () => {
    await postForClient(request(clientUrl, { invitation_states: ['expired'] }));
    expect(state.calls[0]).toEqual({
      clientId: CLIENT,
      contactIds: undefined,
      allEligible: false,
      invitationStates: ['expired'],
    });
  });

  it('rejects a body that names neither contacts, all_eligible nor invitation states', async () => {
    const res = await postForClient(request(clientUrl, {}));
    expect(res.status).toBe(400);
    expect(state.calls).toHaveLength(0);
  });

  it('rejects an invitation state the batch does not understand', async () => {
    const res = await postForClient(request(clientUrl, { invitation_states: ['whenever'] }));
    expect(res.status).toBe(400);
    expect(state.calls).toHaveLength(0);
  });

  it('rejects an empty invitation-state list rather than inviting everyone', async () => {
    const res = await postForClient(request(clientUrl, { invitation_states: [] }));
    expect(res.status).toBe(400);
    expect(state.calls).toHaveLength(0);
  });

  it('rejects more contacts than the batch cap', async () => {
    const contactIds = Array.from({ length: 501 }, () => CONTACT_A);
    const res = await postForClient(request(clientUrl, { contact_ids: contactIds }));
    expect(res.status).toBe(400);
    expect(state.calls).toHaveLength(0);
  });

  it('turns a permission refusal into a 403', async () => {
    state.result = {
      success: false,
      total: 0, sent: 0, skipped: 0, failed: 0, results: [],
      error: 'Permission denied: Cannot invite users',
      errorCode: 'PERMISSION_DENIED_INVITE',
    };
    const res = await postForClient(request(clientUrl, { all_eligible: true }));
    expect(res.status).toBe(403);
  });
});

describe('POST /api/v1/portal-invitations/bulk', () => {
  it('invites the named contacts without a client scope', async () => {
    const res = await postBulk(request(bulkUrl, { contact_ids: [CONTACT_A, CONTACT_B] }));
    expect(res.status).toBe(200);
    expect(state.calls[0]).toEqual({ contactIds: [CONTACT_A, CONTACT_B] });
  });

  it('requires at least one contact id', async () => {
    const res = await postBulk(request(bulkUrl, { contact_ids: [] }));
    expect(res.status).toBe(400);
    expect(state.calls).toHaveLength(0);
  });

  it('rejects a non-uuid contact id rather than forwarding it', async () => {
    const res = await postBulk(request(bulkUrl, { contact_ids: ['not-a-uuid'] }));
    expect(res.status).toBe(400);
    expect(state.calls).toHaveLength(0);
  });
});
