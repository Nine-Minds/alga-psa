import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { fakeTable } from '@alga-psa/db/testing';

let providerRow: any;
const tableReads: string[] = [];
const conversationRoutes: Record<string, any>[] = [];
const ingressRows: Record<string, any>[] = [];

const getAdminConnectionMock = vi.fn(async () => knexMock);
const enqueueUnifiedInboundEmailQueueJobMock = vi.fn();
const enqueueInboundEmailDurableJobMock = vi.fn();

// Table doubles come from the shared db test layer. This handler reads the
// provider, the workspace product gate, and the co-managed inbound policy;
// a hand-rolled chainable refuses whichever table the product added last.
const knexMock = vi.fn((table: string) => {
  tableReads.push(table);
  return fakeTable({
    strict: true,
    tables: {
      // A real IMAP provider row carries its provider_type: the handler looks
      // the provider up by { id, provider_type: 'imap' }.
      email_providers: providerRow ? [{ provider_type: 'imap', ...providerRow }] : [],
      // Independent PSA workspace, no co-management: the product gate and the
      // durable-intake policy both read these.
      tenants: [{ tenant: providerRow?.tenant ?? 'tenant-1', product_code: 'psa' }],
      co_management_relationships: [],
      ticket_conversation_email_routes: conversationRoutes,
      inbound_email_ingress: ingressRows,
    },
    perTable: {
      inbound_email_ingress: {
        onInsert: rows => {
          const inserted = rows.map(row => ({ ...row, ingress_id: 'ingress-imap-1' }));
          ingressRows.push(...inserted);
          return inserted;
        },
      },
    },
  }, undefined, table.split(' ')[0]);
});
Object.assign(knexMock, { fn: { now: () => new Date() } });

vi.mock('@alga-psa/db/admin', () => ({
  getAdminConnection: (...args: any[]) => getAdminConnectionMock(...args),
}));

vi.mock('@alga-psa/shared/services/email/unifiedInboundEmailQueue', () => ({
  enqueueUnifiedInboundEmailQueueJob: (...args: any[]) => enqueueUnifiedInboundEmailQueueJobMock(...args),
}));

vi.mock('@alga-psa/shared/services/email/unifiedInboundEmailQueueV2', () => ({
  enqueueInboundEmailDurableJob: (...args: any[]) => enqueueInboundEmailDurableJobMock(...args),
}));

describe('IMAP webhook handoff', () => {
  beforeEach(() => {
    vi.stubEnv('IMAP_WEBHOOK_SECRET', 'imap-secret');
    vi.stubEnv('UNIFIED_INBOUND_EMAIL_DURABLE_MODE', 'off');
    providerRow = {
      id: 'provider-imap-1',
      tenant: 'tenant-1',
      is_active: true,
      mailbox: 'support@example.com',
    };
    tableReads.length = 0;
    conversationRoutes.length = 0;
    ingressRows.length = 0;
    enqueueInboundEmailDurableJobMock.mockReset().mockResolvedValue(undefined);
    getAdminConnectionMock.mockClear();
    enqueueUnifiedInboundEmailQueueJobMock.mockReset();
    enqueueUnifiedInboundEmailQueueJobMock.mockResolvedValue({
      job: { jobId: 'job-imap-1' },
      queueDepth: 1,
    });
    knexMock.mockClear();
  });
  afterEach(() => vi.unstubAllEnvs());

  function makePointerRequest(
    pointerOverrides: Record<string, any> = {},
    secret = 'imap-secret',
    payloadOverrides: Record<string, any> = {}
  ) {
    return new NextRequest('http://localhost:3000/api/email/webhooks/imap', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-imap-webhook-secret': secret,
      },
      body: JSON.stringify({
        providerId: providerRow?.id || 'provider-imap-missing',
        tenant: providerRow?.tenant || 'tenant-1',
        pointer: {
          mailbox: 'INBOX',
          uid: '77',
          uidValidity: '999',
          messageId: '<imap-msg-77@example.com>',
          ...pointerOverrides,
        },
        ...payloadOverrides,
      }),
    });
  }

  it('T003: IMAP ingress enqueues a pointer-only unified queue payload with required identifiers', async () => {
    const { POST } = await import('@alga-psa/integrations/webhooks/email/imap');

    const response = await POST(makePointerRequest());
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      success: true,
      queued: true,
      handoff: 'unified_pointer_queue',
      providerId: providerRow.id,
      tenant: providerRow.tenant,
      uid: '77',
      messageId: '<imap-msg-77@example.com>',
    });

    expect(enqueueUnifiedInboundEmailQueueJobMock).toHaveBeenCalledTimes(1);
    expect(enqueueUnifiedInboundEmailQueueJobMock).toHaveBeenCalledWith({
      tenantId: providerRow.tenant,
      providerId: providerRow.id,
      provider: 'imap',
      pointer: {
        mailbox: 'INBOX',
        uid: '77',
        uidValidity: '999',
        messageId: '<imap-msg-77@example.com>',
      },
    });
  });

  it('T008: a paused IMAP provider returns a deliberate skip and does not enqueue', async () => {
    providerRow.inbound_paused_at = '2026-07-23T18:00:00.000Z';
    const { POST } = await import('@alga-psa/integrations/webhooks/email/imap');

    const response = await POST(makePointerRequest());

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      success: true,
      skipped: true,
      reason: 'Provider inbound ingestion is paused',
    });
    expect(enqueueUnifiedInboundEmailQueueJobMock).not.toHaveBeenCalled();
  });

  it('retained conversation routes require durable ingress even when the rollout is off', async () => {
    conversationRoutes.push({ tenant: providerRow.tenant, mailbox_id: providerRow.id });
    enqueueInboundEmailDurableJobMock.mockImplementation(async () => {
      expect(ingressRows).toEqual([expect.objectContaining({
        tenant: providerRow.tenant,
        provider_id: providerRow.id,
        provider_type: 'imap',
        status: 'received',
      })]);
    });
    const { POST } = await import('@alga-psa/integrations/webhooks/email/imap');

    const response = await POST(makePointerRequest());

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ handoff: 'durable_ingress', ingressId: 'ingress-imap-1' });
    expect(enqueueInboundEmailDurableJobMock).toHaveBeenCalledExactlyOnceWith({
      workType: 'stage_ingress', tenantId: providerRow.tenant, recordId: 'ingress-imap-1',
    });
    expect(enqueueUnifiedInboundEmailQueueJobMock).not.toHaveBeenCalled();
  });

  it('another tenant conversation route does not change the legacy pointer handoff', async () => {
    conversationRoutes.push({ tenant: 'other-tenant', mailbox_id: providerRow.id });
    const { POST } = await import('@alga-psa/integrations/webhooks/email/imap');

    const response = await POST(makePointerRequest());

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ handoff: 'unified_pointer_queue' });
    expect(enqueueUnifiedInboundEmailQueueJobMock).toHaveBeenCalledOnce();
    expect(enqueueInboundEmailDurableJobMock).not.toHaveBeenCalled();
    expect(ingressRows).toEqual([]);
  });

  it('T006: IMAP callback success waits for durable enqueue completion', async () => {
    const { POST } = await import('@alga-psa/integrations/webhooks/email/imap');

    let resolveEnqueue!: (value: { job: { jobId: string }; queueDepth: number }) => void;
    const enqueueGate = new Promise<{ job: { jobId: string }; queueDepth: number }>((resolve) => {
      resolveEnqueue = resolve;
    });
    enqueueUnifiedInboundEmailQueueJobMock.mockImplementation(() => enqueueGate);

    let settled = false;
    const responsePromise = POST(makePointerRequest({ uid: '88', messageId: '<imap-msg-88@example.com>' })).then(
      (response) => {
        settled = true;
        return response;
      }
    );

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(enqueueUnifiedInboundEmailQueueJobMock).toHaveBeenCalledTimes(1);
    expect(settled).toBe(false);

    resolveEnqueue({ job: { jobId: 'job-imap-gated' }, queueDepth: 3 });
    const response = await responsePromise;
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      success: true,
      queued: true,
      handoff: 'unified_pointer_queue',
      providerId: providerRow.id,
      tenant: providerRow.tenant,
      uid: '88',
      messageId: '<imap-msg-88@example.com>',
    });
  });

  it('T007: IMAP unified ingress returns non-2xx when enqueue fails', async () => {
    enqueueUnifiedInboundEmailQueueJobMock.mockRejectedValue(new Error('redis unavailable'));
    const { POST } = await import('@alga-psa/integrations/webhooks/email/imap');

    const response = await POST(makePointerRequest({ uid: '99', messageId: '<imap-msg-99@example.com>' }));
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body).toMatchObject({
      error: 'Failed to enqueue IMAP pointer job',
    });
  });

  it('T029: IMAP secret verification remains enforced in enqueue-only mode', async () => {
    const { POST } = await import('@alga-psa/integrations/webhooks/email/imap');

    const response = await POST(makePointerRequest({}, 'wrong-secret'));
    expect(response.status).toBe(401);
    expect(enqueueUnifiedInboundEmailQueueJobMock).not.toHaveBeenCalled();
  });

  it('returns 400 when pointer.uid is missing', async () => {
    const { POST } = await import('@alga-psa/integrations/webhooks/email/imap');

    const response = await POST(makePointerRequest({ uid: undefined }));
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body).toMatchObject({
      error: 'pointer.uid is required',
    });
    expect(enqueueUnifiedInboundEmailQueueJobMock).not.toHaveBeenCalled();
  });

  it('returns 400 when tenant hint mismatches provider tenant', async () => {
    const { POST } = await import('@alga-psa/integrations/webhooks/email/imap');
    const request = new NextRequest('http://localhost:3000/api/email/webhooks/imap', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-imap-webhook-secret': 'imap-secret',
      },
      body: JSON.stringify({
        providerId: providerRow.id,
        tenant: 'other-tenant',
        pointer: { mailbox: 'INBOX', uid: '101' },
      }),
    });

    const response = await POST(request);
    expect(response.status).toBe(400);
    expect(enqueueUnifiedInboundEmailQueueJobMock).not.toHaveBeenCalled();
  });

  it('returns skipped=true when provider is inactive', async () => {
    providerRow = {
      ...providerRow,
      is_active: false,
    };
    const { POST } = await import('@alga-psa/integrations/webhooks/email/imap');

    const response = await POST(makePointerRequest());
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      success: true,
      skipped: true,
      reason: 'Provider is inactive',
    });
    expect(enqueueUnifiedInboundEmailQueueJobMock).not.toHaveBeenCalled();
  });

  it('returns 404 when provider does not exist', async () => {
    providerRow = null;
    const { POST } = await import('@alga-psa/integrations/webhooks/email/imap');

    const response = await POST(makePointerRequest());
    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body).toMatchObject({
      error: 'IMAP provider not found',
    });
    expect(enqueueUnifiedInboundEmailQueueJobMock).not.toHaveBeenCalled();
  });
});
