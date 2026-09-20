import { beforeEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => {
  const store = { providers: [] as any[] };

  const createQuery = () => {
    const filters: Record<string, unknown>[] = [];
    const query: any = {
      where(cond: Record<string, unknown>) {
        filters.push(cond);
        return query;
      },
      async first() {
        const [row] = store.providers.filter((row) =>
          filters.every((cond) => Object.entries(cond).every(([k, v]) => row[k] === v)));
        return row ? { ...row } : undefined;
      },
    };
    return query;
  };

  const knexMock: any = () => createQuery();
  return { store, knexMock, createQuery };
});

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: async () => ({ knex: hoisted.knexMock }),
  tenantDb: (_knex: any, tenant: string) => ({
    table: () => hoisted.createQuery().where({ tenant }),
  }),
}));

import { handleThreecxReportChat } from './reportChatHandler';
import type { ThreecxRouteDeps } from './deps';

const TENANT = 'tenant-uuid-1';
const KEY = 'the-secret-key';

function makeDeps(overrides: Partial<ThreecxRouteDeps> = {}): ThreecxRouteDeps {
  return {
    resolveTenantSlug: vi.fn(async () => TENANT),
    checkRateLimit: vi.fn(async () => true),
    getProviderAvailability: vi.fn(async () => ({ enabled: true })),
    enqueueCanonicalCall: vi.fn(async () => undefined),
    enqueueChat: vi.fn(async () => undefined),
    ...overrides,
  };
}

function chatRequest(body: unknown, key: string | null = KEY): Request {
  const url = 'https://app.example.com/api/telephony/3cx/abcdef012345/report-chat';
  const headers = new Headers({ 'content-type': 'application/json' });
  if (key !== null) headers.set('authorization', `Bearer ${key}`);
  return new Request(url, { method: 'POST', headers, body: JSON.stringify(body) });
}

const validBody = {
  number: '+15551234567',
  email: 'dorothy@example.com',
  name: 'Dorothy Gale',
  agentEmail: 'agent@example.com',
  durationSeconds: 90,
  startTimeUtc: '2026-09-15T10:00:00Z',
  endTimeUtc: '2026-09-15T10:01:30Z',
  messages: 'Dorothy: hello\nAgent: hi',
};

describe('3CX report-chat handler', () => {
  beforeEach(() => {
    hoisted.store.providers.length = 0;
    hoisted.store.providers.push({ tenant: TENANT, provider: '3cx', status: 'active', webhook_secret: KEY });
  });

  it('T144: unknown slug answers 404 and a wrong key answers 403', async () => {
    const unknown = await handleThreecxReportChat(chatRequest(validBody), 'nope', makeDeps({ resolveTenantSlug: vi.fn(async () => null) }));
    expect(unknown.status).toBe(404);

    const badKey = await handleThreecxReportChat(chatRequest(validBody, 'wrong'), 'abcdef012345', makeDeps());
    expect(badKey.status).toBe(403);
  });

  it('T145: answers 400 when messages or startTimeUtc is missing', async () => {
    const { messages: _m, ...noMessages } = validBody;
    const { startTimeUtc: _s, ...noStart } = validBody;
    const deps = makeDeps();

    expect((await handleThreecxReportChat(chatRequest(noMessages), 'abcdef012345', deps)).status).toBe(400);
    expect((await handleThreecxReportChat(chatRequest(noStart), 'abcdef012345', deps)).status).toBe(400);
    expect(deps.enqueueChat).not.toHaveBeenCalled();
  });

  it('T146: a valid report-chat answers 202 with providerChatId and enqueues the chat only', async () => {
    const deps = makeDeps();
    const res = await handleThreecxReportChat(chatRequest(validBody), 'abcdef012345', deps);
    expect(res.status).toBe(202);
    const payload = await res.json();
    expect(payload).toMatchObject({ accepted: true });
    expect(payload.providerChatId).toMatch(/^[a-f0-9]{64}$/);
    expect(deps.enqueueChat).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: TENANT,
      chat: expect.objectContaining({ provider: '3cx', providerChatId: payload.providerChatId, messages: validBody.messages }),
    }));
    expect(deps.enqueueCanonicalCall).not.toHaveBeenCalled();
    // The DB mock exposes no telephony_chat_records store, so any direct write would throw.
  });
});
