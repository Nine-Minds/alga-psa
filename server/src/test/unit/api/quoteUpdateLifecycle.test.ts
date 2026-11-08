// @vitest-environment node

/**
 * alga-2026-0003002: `PUT /api/v1/quotes/{id}` accepted `status`, so a `billing:update` user could
 * move a quote pending_approval -> approved (even their own), bypassing `quotes:approve` and the
 * self-approval policy on `/approve`. These tests pin the fix: `status` is not an update field,
 * the service rejects it at runtime, and `cancel` is a real lifecycle command.
 */

import fs from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  quoteUpdate: vi.fn(),
  quoteGetById: vi.fn(),
  activityCreate: vi.fn(),
  hasPermission: vi.fn(),
  lockedRow: { current: null as Record<string, any> | null },
  tenantDbCalls: [] as string[],
}));

vi.mock('@alga-psa/billing/models', () => ({
  Quote: { update: mocks.quoteUpdate, getById: mocks.quoteGetById },
  QuoteItem: {},
  QuoteActivity: { create: mocks.activityCreate },
}));

vi.mock('@alga-psa/billing/services', () => ({
  buildQuoteConversionPreview: vi.fn(),
  convertQuoteToDraftContract: vi.fn(),
  convertQuoteToDraftInvoice: vi.fn(),
  convertQuoteToDraftContractAndInvoice: vi.fn(),
}));

vi.mock('@alga-psa/opportunities/lib/quoteLifecycleHooks', () => ({
  onQuoteSent: vi.fn(),
  onQuoteAccepted: vi.fn(),
}));

vi.mock('@alga-psa/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@alga-psa/db')>();
  return {
    ...actual,
    withTransaction: vi.fn(async (_knex: unknown, fn: (trx: unknown) => Promise<unknown>) => fn({ fake: 'trx' })),
    // Records the order of operations so the test can prove the row is locked (FOR UPDATE) first.
    tenantDb: vi.fn(() => ({
      table: () => ({
        where: () => ({
          forUpdate: () => {
            mocks.tenantDbCalls.push('forUpdate');
            return { first: async () => mocks.lockedRow.current };
          },
        }),
      }),
    })),
  };
});

vi.mock('../../../lib/auth/rbac', () => ({ hasPermission: mocks.hasPermission }));
vi.mock('@/lib/auth/rbac', () => ({ hasPermission: mocks.hasPermission }));
vi.mock('@/lib/api/controllers/authorizationKernel', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api/controllers/authorizationKernel')>()),
  authorizeApiResourceRead: vi.fn(async () => true),
}));
vi.mock('@/lib/db/db', () => ({ getConnection: vi.fn(async () => ({})) }));
vi.mock('@/lib/db', () => ({
  runWithTenant: async (_tenant: string, fn: () => Promise<unknown>) => fn(),
}));

const { updateQuoteApiSchema } = await import('@/lib/api/schemas/quoteSchemas');
const { QuoteService } = await import('@/lib/api/services/QuoteService');
const { ApiQuoteController } = await import('@/lib/api/controllers/ApiQuoteController');

const TENANT = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const QUOTE_ID = '33333333-3333-4333-8333-333333333333';

const ctx = {
  tenant: TENANT,
  userId: USER_ID,
  user: { user_id: USER_ID, user_type: 'internal', tenant: TENANT },
} as any;

function makeService() {
  const service = new QuoteService();
  const getKnex = vi.spyOn(service as any, 'getKnex').mockResolvedValue({ knex: {}, tenant: TENANT });
  return { service, getKnex };
}

function makeController(permissions: Record<string, boolean>) {
  mocks.hasPermission.mockImplementation(async (_user: unknown, resource: string, action: string) =>
    permissions[`${resource}:${action}`] === true,
  );
  const controller = new ApiQuoteController();
  // The parent-read narrowing step loads the quote through the service; keep it off the DB.
  for (const svc of new Set([(controller as any).quoteService, (controller as any).service])) {
    vi.spyOn(svc, 'getKnex').mockResolvedValue({ knex: {}, tenant: TENANT });
  }
  vi.spyOn((controller as any).quoteService, 'getById').mockImplementation(async () => ({ ...pendingQuote }));
  vi.spyOn(controller as any, 'authenticate').mockImplementation(async (req: any) => {
    req.context = ctx;
    return req;
  });
  return controller;
}

function request(method: string, suffix: string, body?: unknown): NextRequest {
  const req = new NextRequest(`https://example.test/api/v1/quotes/${QUOTE_ID}${suffix}`, {
    method,
    headers: { 'x-api-key': 'test', 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  (req as any).params = Promise.resolve({ id: QUOTE_ID });
  return req;
}

const pendingQuote = { quote_id: QUOTE_ID, status: 'pending_approval', created_by: USER_ID, is_template: false };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.tenantDbCalls.length = 0;
  mocks.lockedRow.current = { ...pendingQuote };
  mocks.quoteGetById.mockImplementation(async () => ({ ...pendingQuote }));
});

describe('quote update cannot change status (alga-2026-0003002)', () => {
  it('1: updateQuoteApiSchema rejects `status`', () => {
    expect(updateQuoteApiSchema.safeParse({ status: 'approved' }).success).toBe(false);
    expect(updateQuoteApiSchema.safeParse({ status: 'cancelled', client_notes: 'x' }).success).toBe(false);
    expect(updateQuoteApiSchema.safeParse({ status: null }).success).toBe(false);
    // Empty and content-only bodies still parse.
    expect(updateQuoteApiSchema.safeParse({}).success).toBe(true);
    expect(updateQuoteApiSchema.safeParse({ client_notes: 'x' }).success).toBe(true);
  });

  it('2: QuoteService.update rejects `status` with 400 before any DB access (schema bypassed via cast)', async () => {
    const { service, getKnex } = makeService();

    await expect(service.update(QUOTE_ID, { status: 'approved' } as any, ctx)).rejects.toMatchObject({
      statusCode: 400,
      message: expect.stringMatching(/submit.*approve.*send.*cancel/),
    });

    expect(getKnex).not.toHaveBeenCalled();
    expect(mocks.quoteUpdate).not.toHaveBeenCalled();
    expect(mocks.activityCreate).not.toHaveBeenCalled();
  });

  it('3: a billing:update user without quotes:approve is denied on /approve and cannot approve via PUT', async () => {
    const controller = makeController({ 'billing:update': true, 'billing:read': true });
    const approveSpy = vi.spyOn((controller as any).quoteService, 'approve');
    const updateSpy = vi.spyOn((controller as any).quoteService, 'update');

    // Dedicated route: denied by checkQuoteApprovePermission.
    const approveRes = await controller.approve()(request('POST', '/approve'));
    expect(approveRes.status).toBe(403);
    expect(approveSpy).not.toHaveBeenCalled();

    // Generic route: `status` is a 400 and nothing is written.
    const putRes = await controller.update()(request('PUT', '', { status: 'approved' }));
    expect(putRes.status).toBe(400);
    expect(updateSpy).not.toHaveBeenCalled();
    expect(mocks.quoteUpdate).not.toHaveBeenCalled();
  });

  it('4: /approve still enforces quotes:approve and the self-approval policy (route unchanged)', () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, '../../../lib/api/controllers/ApiQuoteController.ts'),
      'utf8',
    );
    const approveBody = source.slice(source.indexOf('  approve() {'), source.indexOf('  requestChanges() {'));
    expect(approveBody).toContain('await this.checkQuoteApprovePermission(apiRequest);');
    expect(approveBody).toContain('await this.assertQuoteApproveAllowed(apiRequest, existingQuote as Record<string, any>);');
    expect(approveBody).toContain("existingQuote.status !== 'pending_approval'");
    expect(approveBody).toContain('this.quoteService.approve(id, apiRequest.context, { selfApproved })');
    // Self-approval enforcement itself is covered by quoteSelfApproval.integration.test.ts.
  });

  it('5: a content-only update still works and does not touch status', async () => {
    const { service } = makeService();
    mocks.quoteUpdate.mockResolvedValue({ ...pendingQuote, client_notes: 'hello' });

    const result = await service.update(QUOTE_ID, { client_notes: 'hello' }, ctx);

    expect(result.status).toBe('pending_approval');
    expect(mocks.quoteUpdate).toHaveBeenCalledTimes(1);
    const patch = mocks.quoteUpdate.mock.calls[0][3];
    expect(patch).toMatchObject({ client_notes: 'hello', updated_by: USER_ID });
    expect(patch).not.toHaveProperty('status');
  });

  it('5b: PUT with a content-only body reaches the service and succeeds', async () => {
    const controller = makeController({ 'billing:update': true, 'billing:read': true });
    mocks.quoteUpdate.mockResolvedValue({ ...pendingQuote, client_notes: 'hello' });

    const res = await controller.update()(request('PUT', '', { client_notes: 'hello' }));
    expect(res.status).toBe(200);
    expect(mocks.quoteUpdate).toHaveBeenCalledTimes(1);
  });
});

describe('QuoteService.cancel', () => {
  it('6a: legal transition locks the row first, cancels, and writes an audit row with the reason', async () => {
    const { service } = makeService();
    mocks.hasPermission.mockResolvedValue(true);
    mocks.lockedRow.current = { ...pendingQuote, status: 'sent' };
    mocks.quoteUpdate.mockImplementation(async () => {
      // The FOR UPDATE lock must already have been taken when the status is persisted.
      expect(mocks.tenantDbCalls).toEqual(['forUpdate']);
      return { ...pendingQuote, status: 'cancelled' };
    });

    const result = await service.cancel(QUOTE_ID, 'Customer withdrew', ctx);

    expect(result.status).toBe('cancelled');
    expect(mocks.quoteUpdate).toHaveBeenCalledWith(
      expect.anything(),
      TENANT,
      QUOTE_ID,
      expect.objectContaining({ status: 'cancelled', updated_by: USER_ID }),
    );
    expect(mocks.activityCreate).toHaveBeenCalledWith(
      expect.anything(),
      TENANT,
      expect.objectContaining({
        quote_id: QUOTE_ID,
        activity_type: 'cancelled',
        performed_by: USER_ID,
        metadata: { reason: 'Customer withdrew', previous_status: 'sent' },
      }),
    );
  });

  it.each(['converted', 'superseded', 'archived'])(
    '6b: cancelling from %s is a 409 and writes nothing',
    async (status) => {
      const { service } = makeService();
      mocks.hasPermission.mockResolvedValue(true);
      mocks.lockedRow.current = { ...pendingQuote, status };

      await expect(service.cancel(QUOTE_ID, undefined, ctx)).rejects.toMatchObject({ statusCode: 409 });
      expect(mocks.quoteUpdate).not.toHaveBeenCalled();
      expect(mocks.activityCreate).not.toHaveBeenCalled();
    },
  );

  it('6b2: cancelling an already-cancelled quote is a no-op (no write, no audit row)', async () => {
    const { service } = makeService();
    mocks.hasPermission.mockResolvedValue(true);
    mocks.lockedRow.current = { ...pendingQuote, status: 'cancelled' };

    const result = await service.cancel(QUOTE_ID, 'again', ctx);

    expect(result.status).toBe('cancelled');
    expect(mocks.quoteUpdate).not.toHaveBeenCalled();
    expect(mocks.activityCreate).not.toHaveBeenCalled();
  });

  it('6c: unknown quote is a 404, and a caller without billing:update is a 403', async () => {
    const { service } = makeService();
    mocks.hasPermission.mockResolvedValue(true);
    mocks.lockedRow.current = null;
    await expect(service.cancel(QUOTE_ID, undefined, ctx)).rejects.toMatchObject({ statusCode: 404 });

    mocks.hasPermission.mockResolvedValue(false);
    mocks.lockedRow.current = { ...pendingQuote };
    await expect(service.cancel(QUOTE_ID, undefined, ctx)).rejects.toMatchObject({ statusCode: 403 });
    expect(mocks.quoteUpdate).not.toHaveBeenCalled();
  });

  it('6d: POST /cancel route returns 409 for an illegal source status', async () => {
    const controller = makeController({ 'billing:update': true, 'billing:read': true });
    mocks.lockedRow.current = { ...pendingQuote, status: 'converted' };

    const res = await controller.cancel()(request('POST', '/cancel', { reason: 'x' }));
    expect(res.status).toBe(409);
    expect(mocks.quoteUpdate).not.toHaveBeenCalled();
  });
});
