import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  tenantScopes: [] as string[],
  ingestChat: vi.fn(),
}));

vi.mock('@alga-psa/core/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('@alga-psa/db', () => ({
  runWithTenant: async (tenantId: string, fn: () => Promise<unknown>) => {
    mocks.tenantScopes.push(tenantId);
    return fn();
  },
}));

vi.mock('@alga-psa/telephony', () => ({
  ingestChat: mocks.ingestChat,
}));

const chat = {
  provider: '3cx',
  providerChatId: 'chat-hash-1',
  agentEmail: 'agent@example.com',
  email: 'dorothy@example.com',
  startedAt: '2026-09-15T10:00:00Z',
  messages: 'hi',
  raw: {},
};

let processThreecxChat: (data: any) => Promise<void>;
let THREECX_CHAT_JOB: string;

beforeAll(async () => {
  process.env.EDITION = 'ee';
  ({ processThreecxChat, THREECX_CHAT_JOB } = await import('./threecxChatHandler'));
});

describe('processThreecxChat', () => {
  beforeEach(() => {
    mocks.tenantScopes.length = 0;
    vi.clearAllMocks();
    mocks.ingestChat.mockResolvedValue({ status: 'ingested', chatRecordId: 'chat-1', matchStatus: 'matched', interactionId: 'i-1' });
  });

  it('names the job process-threecx-chat', () => {
    expect(THREECX_CHAT_JOB).toBe('process-threecx-chat');
  });

  it('ingests the chat inside the tenant scope', async () => {
    await processThreecxChat({ tenantId: 'tenant-1', chat });
    expect(mocks.tenantScopes).toEqual(['tenant-1']);
    expect(mocks.ingestChat).toHaveBeenCalledWith({ tenantId: 'tenant-1', chat });
  });
});
