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

describe('ResendEmailProvider record name resolution', () => {
  beforeEach(() => {
    clientMock.post.mockReset();
    clientMock.get.mockReset();
  });

  // Resend names records relative to the registrable zone, so the same raw
  // payload shape means different FQDNs depending on the registered domain.
  const resendRecords = (label: string) => [
    { record: 'DKIM', name: label ? `resend._domainkey.${label}` : 'resend._domainkey', type: 'TXT', value: 'p=abc' },
    { record: 'SPF', name: label ? `send.${label}` : 'send', type: 'MX', value: 'feedback-smtp.us-east-1.amazonses.com', priority: '10' },
    { record: 'SPF', name: label ? `send.${label}` : 'send', type: 'TXT', value: 'v=spf1 include:amazonses.com ~all' },
    { record: 'SPF', name: label ? `rsend.${label}` : 'rsend', type: 'CNAME', value: 'send.forge.rmta.net' },
  ];

  const createWithRecords = async (domain: string, label: string) => {
    const provider = await createProvider();
    clientMock.post.mockResolvedValueOnce({
      data: { id: 'dom-2', name: domain, status: 'not_started', region: 'us-east-1', created_at: '2026-01-01T00:00:00Z', records: resendRecords(label) },
    });
    const result = await provider.createDomain(domain);
    return result.dnsRecords.map((record) => [record.type, record.name, record.host]);
  };

  it('appends the full domain for an apex domain', async () => {
    expect(await createWithRecords('example.com', '')).toEqual([
      ['TXT', 'resend._domainkey.example.com', 'resend._domainkey'],
      ['MX', 'send.example.com', 'send'],
      ['TXT', 'send.example.com', 'send'],
      ['CNAME', 'rsend.example.com', 'rsend'],
    ]);
  });

  it('does not repeat the subdomain label for a subdomain', async () => {
    expect(await createWithRecords('e.resxtech.com', 'e')).toEqual([
      ['TXT', 'resend._domainkey.e.resxtech.com', 'resend._domainkey.e'],
      ['MX', 'send.e.resxtech.com', 'send.e'],
      ['TXT', 'send.e.resxtech.com', 'send.e'],
      ['CNAME', 'rsend.e.resxtech.com', 'rsend.e'],
    ]);
  });

  it('handles a multi-label public suffix treated as the zone', async () => {
    expect(await createWithRecords('nuviis.it.com', 'nuviis')).toEqual([
      ['TXT', 'resend._domainkey.nuviis.it.com', 'resend._domainkey.nuviis'],
      ['MX', 'send.nuviis.it.com', 'send.nuviis'],
      ['TXT', 'send.nuviis.it.com', 'send.nuviis'],
      ['CNAME', 'rsend.nuviis.it.com', 'rsend.nuviis'],
    ]);
  });

  it('keeps a three-label apex domain intact', async () => {
    expect(await createWithRecords('jayscomputers.com.au', '')).toEqual([
      ['TXT', 'resend._domainkey.jayscomputers.com.au', 'resend._domainkey'],
      ['MX', 'send.jayscomputers.com.au', 'send'],
      ['TXT', 'send.jayscomputers.com.au', 'send'],
      ['CNAME', 'rsend.jayscomputers.com.au', 'rsend'],
    ]);
  });

  it('passes through already-qualified names and maps the apex to @', async () => {
    const provider = await createProvider();
    clientMock.post.mockResolvedValueOnce({
      data: {
        id: 'dom-3', name: 'example.com', status: 'not_started', region: 'us-east-1', created_at: '2026-01-01T00:00:00Z',
        records: [
          { record: 'SPF', name: 'send.example.com', type: 'TXT', value: 'v=spf1' },
          { record: 'DMARC', name: '', type: 'TXT', value: 'v=DMARC1' },
          { record: 'DMARC', name: '@', type: 'TXT', value: 'v=DMARC1' },
        ],
      },
    });
    const result = await provider.createDomain('example.com');
    expect(result.dnsRecords.map((record) => [record.name, record.host])).toEqual([
      ['send.example.com', 'send'],
      ['example.com', '@'],
      ['example.com', '@'],
    ]);
  });
});
