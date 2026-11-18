/**
 * Authorization contract for GET /api/tickets/:id/email-html.
 *
 * The formatted original-email view is a second read path over the same
 * content as the ticket page, so it must deny exactly what the ticket page
 * denies: the per-record ticket policy for MSP readers, and the portal
 * client/board/contact scope plus the non-internal comment gate for portal
 * readers. These cases pin that wiring rather than the HTML rendering (covered
 * by the shared renderer's own suite).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const TICKET_ID = '11111111-1111-4111-8111-111111111111';
const COMMENT_ID = '22222222-2222-4222-8222-222222222222';
const TENANT = '33333333-3333-4333-8333-333333333333';

type Row = Record<string, unknown> | undefined;

interface FakeQuery {
  table: string;
  wheres: unknown[];
  [key: string]: any;
}

const emailMetadata = { messageId: 'abc@example.test', providerId: 'provider-1' };
const commentMetadata = { responseSource: 'inbound_email', email: emailMetadata };

let rows: Record<string, Row>;
let queries: FakeQuery[];
let currentUser: Record<string, unknown> | null;
let hasPermissionResult: boolean;
let authorizeError: Error | null;
let renderedHtml: string | null;
let renderInboundEmailHtml: ReturnType<typeof vi.fn>;
let applyTicketVisibilityFilter: ReturnType<typeof vi.fn>;

function createQuery(table: string): FakeQuery {
  const query: FakeQuery = {
    table,
    wheres: [],
    where: (...args: unknown[]) => {
      query.wheres.push(args.length === 1 ? args[0] : args);
      return query;
    },
    whereIn: (...args: unknown[]) => {
      query.wheres.push(args);
      return query;
    },
    whereNull: () => query,
    orWhere: () => query,
    whereNotNull: () => query,
    modify: (apply: (builder: FakeQuery) => void) => {
      apply(query);
      return query;
    },
    first: async () => rows[table],
  };
  return query;
}

function queryFor(table: string): FakeQuery {
  const query = queries.find((candidate) => candidate.table === table);
  if (!query) throw new Error(`no query built for ${table}`);
  return query;
}

function mockModules(): void {
  vi.doMock('@alga-psa/db', () => ({
    createTenantKnex: vi.fn(async () => ({ knex: { fake: 'knex' }, tenant: TENANT })),
    withTransaction: vi.fn(async (_knex: unknown, callback: (trx: unknown) => unknown) =>
      callback({ fake: 'trx' })),
    tenantDb: vi.fn(() => ({
      table: (name: string) => {
        const query = createQuery(name);
        queries.push(query);
        return query;
      },
      tenantJoin: vi.fn(),
    })),
  }));

  vi.doMock('@alga-psa/auth/rbac', () => ({
    hasPermission: vi.fn(async () => hasPermissionResult),
  }));

  vi.doMock('@alga-psa/user-composition/actions', () => ({
    getCurrentUser: vi.fn(async () => currentUser),
  }));

  vi.doMock('@alga-psa/tickets/lib/ticketRecordAuthorization', () => ({
    authorizeTicketRecordAccess: vi.fn(async () => {
      if (authorizeError) throw authorizeError;
      return { ticket_id: TICKET_ID };
    }),
  }));

  applyTicketVisibilityFilter = vi.fn((query: unknown) => query);
  vi.doMock('@alga-psa/tickets/lib/clientPortalVisibility', () => ({
    applyTicketVisibilityFilter,
  }));

  vi.doMock('@alga-psa/tickets/lib/clientPortalVisibility.server', () => ({
    getClientContactVisibilityContext: vi.fn(async () => ({
      clientId: 'client-1',
      contactId: 'contact-1',
      effectiveTicketScope: 'client',
      visibleBoardIds: null,
    })),
  }));

  renderInboundEmailHtml = vi.fn(async () => renderedHtml);
  vi.doMock('@shared/services/email/renderInboundEmailHtml', () => ({
    renderInboundEmailHtml,
  }));
}

async function get(search = ''): Promise<Response> {
  const route = await import('@/app/api/tickets/[id]/email-html/route');
  return route.GET(
    new NextRequest(`http://localhost/api/tickets/${TICKET_ID}/email-html${search}`),
    { params: Promise.resolve({ id: TICKET_ID }) }
  ) as unknown as Promise<Response>;
}

describe('GET /api/tickets/:id/email-html authorization', () => {
  beforeEach(() => {
    vi.resetModules();
    rows = {};
    queries = [];
    currentUser = { user_id: 'user-1', tenant: TENANT, user_type: 'internal' };
    hasPermissionResult = true;
    authorizeError = null;
    renderedHtml = '<p>Original</p>';
    mockModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('serves the rendered original email to an MSP reader the ticket policy allows', async () => {
    rows['comments as c'] = { metadata: commentMetadata };

    const response = await get(`?commentId=${COMMENT_ID}`);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ html: '<p>Original</p>' });
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(renderInboundEmailHtml).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: TENANT, messageId: 'abc@example.test', providerId: 'provider-1' })
    );
  });

  it('refuses an MSP reader the per-record ticket policy denies', async () => {
    authorizeError = new Error('Permission denied: Cannot access ticket');

    const response = await get();

    expect(response.status).toBe(403);
    expect(renderInboundEmailHtml).not.toHaveBeenCalled();
  });

  it('refuses a portal reader whose client does not own the ticket', async () => {
    currentUser = { user_id: 'user-2', tenant: TENANT, user_type: 'client', contact_id: 'contact-1' };
    // The client/board/contact scope excludes the ticket, so the read finds nothing.
    rows.tickets = undefined;

    const response = await get();

    expect(response.status).toBe(403);
    expect(renderInboundEmailHtml).not.toHaveBeenCalled();
    expect(queryFor('tickets as t').wheres).toContainEqual(
      expect.objectContaining({ 't.ticket_id': TICKET_ID, 't.client_id': 'client-1' })
    );
    expect(applyTicketVisibilityFilter).toHaveBeenCalled();
  });

  it('refuses a portal reader asking for an internal comment', async () => {
    currentUser = { user_id: 'user-2', tenant: TENANT, user_type: 'client', contact_id: 'contact-1' };
    rows['tickets as t'] = { email_metadata: emailMetadata };
    // The portal comment predicate drops internal and unpublished comments.
    rows['comments as c'] = undefined;

    const response = await get(`?commentId=${COMMENT_ID}`);

    expect(response.status).toBe(403);
    expect(renderInboundEmailHtml).not.toHaveBeenCalled();
    expect(queryFor('comments as c').wheres).toContainEqual(
      expect.objectContaining({ 'c.is_internal': false, 'c.publish_state': 'published' })
    );
  });

  it('answers 404 when no archived email exists for the ticket', async () => {
    rows.tickets = { email_metadata: emailMetadata };
    renderedHtml = null;

    const response = await get();

    expect(response.status).toBe(404);
    expect(renderInboundEmailHtml).toHaveBeenCalled();
  });

  it('answers 404 when the body carries no inbound-email identity', async () => {
    rows.tickets = { email_metadata: null };

    const response = await get();

    expect(response.status).toBe(404);
    expect(renderInboundEmailHtml).not.toHaveBeenCalled();
  });

  it('answers 401 without a session', async () => {
    currentUser = null;

    const response = await get();

    expect(response.status).toBe(401);
  });
});
