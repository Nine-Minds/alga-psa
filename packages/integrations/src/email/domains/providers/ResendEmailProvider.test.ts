import { beforeEach, describe, expect, it, vi } from 'vitest';

const { clientMock } = vi.hoisted(() => ({
  clientMock: {
    post: vi.fn(),
    get: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock('axios', () => ({
  default: {
    create: vi.fn(() => clientMock),
    get: vi.fn(async () => ({ data: {} })),
  },
}));

vi.mock('@alga-psa/core/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { ResendEmailProvider } from './ResendEmailProvider';

const registeredAlreadyError = {
  response: {
    status: 403,
    data: { message: 'The domain example.com is registered already', name: 'validation_error' },
  },
};

const listEntry = {
  id: 'dom-1',
  name: 'example.com',
  status: 'pending',
  region: 'us-east-1',
  created_at: '2026-01-01T00:00:00Z',
};

const detailRecords = [
  { record: 'DKIM', name: 'resend._domainkey', type: 'TXT', value: 'v=DKIM1; k=rsa; p=abc' },
];

async function createProvider(): Promise<ResendEmailProvider> {
  const provider = new ResendEmailProvider('managed-resend');
  await provider.initialize({ apiKey: 'test-key' });
  return provider;
}

describe('ResendEmailProvider.createDomain 403 recovery', () => {
  beforeEach(() => {
    clientMock.post.mockReset();
    clientMock.get.mockReset();
    clientMock.delete.mockReset();
  });

  it('adopts an already-registered domain even when it is verified', async () => {
    const provider = await createProvider();

    clientMock.post.mockRejectedValueOnce(registeredAlreadyError);
    clientMock.get.mockImplementation(async (url: string) => {
      if (url === '/domains') {
        return { data: { data: [{ ...listEntry, status: 'verified' }] } };
      }
      if (url === '/domains/dom-1') {
        return { data: { ...listEntry, status: 'verified', records: detailRecords } };
      }
      throw new Error(`unexpected GET ${url}`);
    });

    const result = await provider.createDomain('example.com');

    expect(result.domainId).toBe('dom-1');
    expect(result.status).toBe('verified');
    expect(result.dnsRecords).toEqual([
      expect.objectContaining({
        type: 'TXT',
        name: 'resend._domainkey.example.com',
        value: 'v=DKIM1; k=rsa; p=abc',
      }),
    ]);
  });

  it('adopts a pending domain without records when the detail fetch fails', async () => {
    const provider = await createProvider();

    clientMock.post.mockRejectedValueOnce(registeredAlreadyError);
    clientMock.get.mockImplementation(async (url: string) => {
      if (url === '/domains') {
        // The list endpoint never includes `records`
        return { data: { data: [listEntry] } };
      }
      throw new Error('detail fetch unavailable');
    });

    const result = await provider.createDomain('example.com');

    expect(result.domainId).toBe('dom-1');
    expect(result.status).toBe('pending');
    expect(result.dnsRecords).toEqual([]);
  });

  it('rethrows when the domain cannot be found in the account', async () => {
    const provider = await createProvider();

    clientMock.post.mockRejectedValueOnce(registeredAlreadyError);
    clientMock.get.mockResolvedValue({ data: { data: [] } });

    await expect(provider.createDomain('example.com')).rejects.toThrow(
      'Failed to create domain example.com'
    );
  });
});
