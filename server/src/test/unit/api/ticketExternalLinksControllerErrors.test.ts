import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { ExternalLinkValidationError } from '@alga-psa/tickets/actions/externalLinks/externalLinkPersistence';

/**
 * Controller-level coverage for issue #2: inline external-link failures raised
 * while creating a ticket or a comment must surface as structured 4xx API
 * errors (not 500 INTERNAL_ERROR), preserving the machine-readable code.
 */

const throwState = vi.hoisted(() => ({ error: null as unknown }));

const authorizeReadMock = vi.hoisted(() => vi.fn(async () => true));

const linkActionState = vi.hoisted(() => ({
  findResult: null as unknown,
}));

vi.mock('@alga-psa/tickets/actions/externalLinks/externalLinkActions', () => ({
  findTicketByExternalLink: vi.fn(async () => linkActionState.findResult),
  getTicketExternalLinks: vi.fn(async () => []),
  addExternalLink: vi.fn(),
  updateExternalLink: vi.fn(),
  removeExternalLink: vi.fn(),
}));

vi.mock('@/lib/services/apiKeyServiceForApi', () => ({
  ApiKeyServiceForApi: {
    validateApiKeyAnyTenant: vi.fn(async () => ({
      tenant: '11111111-1111-1111-1111-111111111111',
      user_id: 'user-1',
      api_key_id: 'key-1',
    })),
    validateApiKeyForTenant: vi.fn(async () => ({
      tenant: '11111111-1111-1111-1111-111111111111',
      user_id: 'user-1',
      api_key_id: 'key-1',
    })),
  },
}));

vi.mock('@alga-psa/users/actions', () => ({
  findUserByIdForApi: vi.fn(async () => ({
    user_id: 'user-1',
    user_type: 'internal',
    tenant: '11111111-1111-1111-1111-111111111111',
  })),
}));

vi.mock('@/lib/db', () => ({
  runWithTenant: vi.fn(async (_tenant: string, callback: () => Promise<any>) => callback()),
  runWithApiKeyUser: vi.fn(async (_user: unknown, callback: () => Promise<any>) => callback()),
  tenantDb: vi.fn(() => ({ table: () => ({}) })),
}));

vi.mock('@/lib/db/db', () => ({
  getConnection: vi.fn(async () => ({})),
}));

vi.mock('@/lib/auth/rbac', () => ({
  hasPermission: vi.fn(async () => true),
}));

vi.mock('@/lib/api/rateLimit/enforce', () => ({
  enforceApiRateLimit: vi.fn(async () => null),
  shouldBypassRateLimit: vi.fn(() => false),
}));

vi.mock('@/lib/productAccess', () => ({
  getTenantProduct: vi.fn(async () => 'psa'),
}));

vi.mock('@/lib/productSurfaceRegistry', () => ({
  resolveProductApiBehavior: vi.fn(() => 'allowed'),
}));

vi.mock('@/lib/api/controllers/authorizationKernel', () => ({
  authorizeApiResourceRead: authorizeReadMock,
  buildAuthorizationPrincipalSubject: vi.fn(() => ({})),
}));

// The service is the seam that raises the inline-link validation failure.
vi.mock('../../../lib/api/services/TicketService', () => ({
  TicketService: class {
    async create() {
      throw throwState.error;
    }
    async addComment() {
      throw throwState.error;
    }
    async getById() {
      return {
        ticket_id: '22222222-2222-2222-2222-222222222222',
        assigned_to: null,
        entered_by: null,
        client_id: null,
        board_id: null,
        status_id: null,
      };
    }
  },
}));

import { POST as createTicketPOST } from '../../../app/api/v1/tickets/route';
import { POST as createCommentPOST } from '../../../app/api/v1/tickets/[id]/comments/route';
import { GET as byExternalLinkGET } from '../../../app/api/v1/tickets/by-external-link/route';
import { handleApiError } from '../../../lib/api/middleware/apiMiddleware';

const TENANT = '11111111-1111-1111-1111-111111111111';
const CLIENT = '33333333-3333-3333-3333-333333333333';
const BOARD = '44444444-4444-4444-4444-444444444444';
const STATUS = '55555555-5555-5555-5555-555555555555';
const PRIORITY = '66666666-6666-6666-6666-666666666666';
const TICKET = '22222222-2222-2222-2222-222222222222';

function apiHeaders() {
  return { 'x-api-key': 'test-api-key', 'content-type': 'application/json' };
}

describe('external-link validation failures map to structured API errors', () => {
  beforeEach(() => {
    throwState.error = null;
    authorizeReadMock.mockReset();
    authorizeReadMock.mockResolvedValue(true);
    linkActionState.findResult = null;
  });

  it('maps every external-link failure code to a 4xx status preserving the code', () => {
    const cases: Array<[string, number]> = [
      ['origin_exists', 409],
      ['duplicate_external_link', 409],
      ['system_in_use', 409],
      ['url_required', 422],
      ['system_not_found', 422],
      ['invalid_url', 422],
      ['external_id_required', 422],
      ['ticket_not_found', 404],
      ['link_not_found', 404],
    ];

    for (const [code, status] of cases) {
      const response = handleApiError(new ExternalLinkValidationError(code as any, `${code} message`));
      expect(response.status).toBe(status);
    }
  });

  it('rejects a ticket create with two origins as a 409 carrying origin_exists', async () => {
    throwState.error = new ExternalLinkValidationError('origin_exists', 'This entity already has an origin link');

    const request = new NextRequest('http://localhost/api/v1/tickets', {
      method: 'POST',
      headers: apiHeaders(),
      body: JSON.stringify({
        title: 'Atomic create',
        client_id: CLIENT,
        board_id: BOARD,
        status_id: STATUS,
        priority_id: PRIORITY,
        external_links: [
          { system: 'github', realm: 'acme/repo', external_id: '1', relationship: 'origin' },
          { system: 'jira', realm: 'acme.atlassian.net', external_id: '2', relationship: 'origin' },
        ],
      }),
    });

    const response = await createTicketPOST(request);
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.error.code).toBe('origin_exists');
  });

  it('rejects a duplicate external record on ticket create as a 409', async () => {
    throwState.error = new ExternalLinkValidationError(
      'duplicate_external_link',
      'That external record is already linked',
    );

    const request = new NextRequest('http://localhost/api/v1/tickets', {
      method: 'POST',
      headers: apiHeaders(),
      body: JSON.stringify({
        title: 'Duplicate link',
        client_id: CLIENT,
        board_id: BOARD,
        status_id: STATUS,
        priority_id: PRIORITY,
        external_links: [{ system: 'github', realm: 'acme/repo', external_id: 'dup' }],
      }),
    });

    const response = await createTicketPOST(request);
    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe('duplicate_external_link');
  });

  it('rejects an unusable destination on ticket create as a 422', async () => {
    throwState.error = new ExternalLinkValidationError('url_required', 'A clickable URL is required');

    const request = new NextRequest('http://localhost/api/v1/tickets', {
      method: 'POST',
      headers: apiHeaders(),
      body: JSON.stringify({
        title: 'No destination',
        client_id: CLIENT,
        board_id: BOARD,
        status_id: STATUS,
        priority_id: PRIORITY,
        external_links: [{ system: 'github', external_id: 'no-realm' }],
      }),
    });

    const response = await createTicketPOST(request);
    expect(response.status).toBe(422);
    expect((await response.json()).error.code).toBe('url_required');
  });

  it('rejects a comment create with a duplicate external record as a 409', async () => {
    throwState.error = new ExternalLinkValidationError(
      'duplicate_external_link',
      'That external record is already linked',
    );

    const request = new NextRequest(`http://localhost/api/v1/tickets/${TICKET}/comments`, {
      method: 'POST',
      headers: apiHeaders(),
      body: JSON.stringify({
        comment_text: 'hello',
        external_links: [{ system: 'github', realm: 'acme/repo', external_id: 'dup' }],
      }),
    });

    const response = await createCommentPOST(request);
    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe('duplicate_external_link');
  });

  it('rejects a comment create with an unknown system as a 422', async () => {
    throwState.error = new ExternalLinkValidationError('system_not_found', "Unknown external system 'nope'");

    const request = new NextRequest(`http://localhost/api/v1/tickets/${TICKET}/comments`, {
      method: 'POST',
      headers: apiHeaders(),
      body: JSON.stringify({
        comment_text: 'hello',
        external_links: [{ system: 'nope', external_id: '1' }],
      }),
    });

    const response = await createCommentPOST(request);
    expect(response.status).toBe(422);
    expect((await response.json()).error.code).toBe('system_not_found');
  });

  it('returns 403 for a restricted principal on the by-external-link lookup', async () => {
    linkActionState.findResult = {
      ticket_id: TICKET,
      link: { link_id: 'link-1', system: 'github', external_id: '1' },
    };
    authorizeReadMock.mockResolvedValue(false);

    const request = new NextRequest(
      'http://localhost/api/v1/tickets/by-external-link?system=github&external_id=1',
      { headers: apiHeaders() },
    );

    const response = await byExternalLinkGET(request);
    expect(response.status).toBe(403);
  });

  it('returns the ticket and link on the by-external-link lookup when the principal may read it', async () => {
    linkActionState.findResult = {
      ticket_id: TICKET,
      link: { link_id: 'link-1', system: 'github', external_id: '1' },
    };
    authorizeReadMock.mockResolvedValue(true);

    const request = new NextRequest(
      'http://localhost/api/v1/tickets/by-external-link?system=github&external_id=1',
      { headers: apiHeaders() },
    );

    const response = await byExternalLinkGET(request);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.ticket_id).toBe(TICKET);
  });
});
