import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const outbound = vi.hoisted(() => ({ safeFetch: vi.fn(), actualSafeFetch: undefined as any }));
vi.mock('../../../../lib/net/safeFetch', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../lib/net/safeFetch')>();
  outbound.actualSafeFetch = actual.safeFetch;
  return { ...actual, safeFetch: outbound.safeFetch };
});

// This suite deliberately does NOT mock `@alga-psa/storage` (the barrel) or
// `@alga-psa/storage/config/storage`. The workflow helper must resolve the
// real shared upload-policy module; mocking the barrel is what let a
// native-runtime module resolution failure hide from CI (alga-2026-0002491).

const wavBytes = Buffer.concat([
  Buffer.from('RIFF'),
  Buffer.from([0x24, 0x00, 0x00, 0x00]),
  Buffer.from('WAVE'),
  Buffer.from('fmt '),
  Buffer.from([0x10, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00]),
  Buffer.from([0x40, 0x1f, 0x00, 0x00, 0x80, 0x3e, 0x00, 0x00, 0x02, 0x00, 0x10, 0x00]),
  Buffer.from('data'),
  Buffer.from([0x00, 0x00, 0x00, 0x00]),
]);

const uploadMock = vi.fn(async (buffer: Buffer, storagePath: string) => ({
  path: storagePath,
  size: buffer.length,
}));

// Keep the real module graph (and its generateStoragePath export) but stub the
// provider so no bytes are written to disk during the unit test.
vi.mock('@alga-psa/storage/StorageProviderFactory', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@alga-psa/storage/StorageProviderFactory')>();
  return {
    ...actual,
    StorageProviderFactory: {
      createProvider: vi.fn(async () => ({
        upload: uploadMock,
        download: vi.fn(),
        delete: vi.fn(),
      })),
    },
  };
});

vi.mock('@alga-psa/db', () => ({
  tenantDb: (conn: any, tenant: string) => ({ table: (name: string) => conn.table(name, tenant) }),
}));

type Row = Record<string, any>;

const fileRow: Row = {
  file_id: '11111111-1111-4111-8111-111111111111',
  file_name: 'stored-voicemail.wav',
  original_name: 'voicemail.wav',
  mime_type: 'audio/wav',
  file_size: 1234,
  storage_path: 'tenant-1/voicemail.wav',
};

const state: {
  ticket: Row | null;
  file: Row | null;
  documents: Row[];
  associations: Row[];
  externalFiles: Row[];
  fetchHosts: Record<string, Row[]>;
  fetchHostLookupError: Error | null;
} = {
  ticket: null,
  file: null,
  documents: [],
  associations: [],
  externalFiles: [],
  fetchHosts: {},
  fetchHostLookupError: null,
};

function makeBuilder(table: string, tenant?: string) {
  return {
    where: vi.fn().mockReturnThis(),
    first: vi.fn(async () => {
      if (table === 'tickets') return state.ticket;
      if (table === 'external_files') return state.file;
      return undefined;
    }),
    insert: vi.fn(async (row: Row) => {
      if (table === 'documents') state.documents.push(row);
      if (table === 'document_associations') state.associations.push(row);
      if (table === 'external_files') state.externalFiles.push(row);
      return [row];
    }),
    onConflict: vi.fn().mockReturnThis(),
    ignore: vi.fn().mockResolvedValue(undefined),
    select: vi.fn(async () => {
      if (table === 'document_fetch_hosts') {
        if (state.fetchHostLookupError) throw state.fetchHostLookupError;
        return state.fetchHosts[tenant ?? ''] ?? [];
      }
      return [];
    }),
  };
}

const fakeKnex: any = { table: (name: string, tenant?: string) => makeBuilder(name, tenant) };

const ctx = { stepPath: 'step-1', runId: 'run-1' } as any;
const tx = { tenantId: 'tenant-1', actorUserId: 'user-1', trx: fakeKnex } as any;
const ticketId = '22222222-2222-4222-8222-222222222222';

async function resetStoragePolicy(): Promise<void> {
  const { clearCachedStorageConfig } = await import('@alga-psa/storage/config/storage');
  clearCachedStorageConfig();
}

describe('attachDocumentToTicket — real shared upload policy (unmocked storage)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    state.ticket = { ticket_id: ticketId };
    state.file = { ...fileRow };
    state.documents = [];
    state.associations = [];
    state.externalFiles = [];
    state.fetchHosts = {
      'tenant-1': [{ kind: 'custom', host_pattern: 'example.test' }],
    };
    state.fetchHostLookupError = null;
    outbound.safeFetch.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('accepts audio/wav through the real policy (file_id branch)', async () => {
    vi.stubEnv('STORAGE_LOCAL_ALLOWED_MIME_TYPES', '*/*');
    await resetStoragePolicy();

    const { attachDocumentToTicket } = await import('../businessOperations/shared');
    const result = await attachDocumentToTicket(ctx, tx, ticketId, {
      source: { file_id: fileRow.file_id },
    });

    expect(result).toMatchObject({ file_id: fileRow.file_id, content_type: 'audio/wav' });
    expect(state.documents).toHaveLength(1);
    expect(state.associations).toHaveLength(1);
  });

  it('rejects a disallowed MIME through the real policy (file_id branch)', async () => {
    vi.stubEnv('STORAGE_LOCAL_ALLOWED_MIME_TYPES', 'application/pdf');
    await resetStoragePolicy();

    const { attachDocumentToTicket } = await import('../businessOperations/shared');

    await expect(
      attachDocumentToTicket(ctx, tx, ticketId, { source: { file_id: fileRow.file_id } })
    ).rejects.toMatchObject({ category: 'ValidationError', code: 'VALIDATION_ERROR' });

    expect(state.documents).toHaveLength(0);
    expect(state.associations).toHaveLength(0);
  });

  it('rejects an oversize attachment through the real provider size ceiling (file_id branch)', async () => {
    vi.stubEnv('STORAGE_LOCAL_ALLOWED_MIME_TYPES', '*/*');
    vi.stubEnv('STORAGE_LOCAL_MAX_FILE_SIZE', '100');
    await resetStoragePolicy();

    const { attachDocumentToTicket } = await import('../businessOperations/shared');

    await expect(
      attachDocumentToTicket(ctx, tx, ticketId, { source: { file_id: fileRow.file_id } })
    ).rejects.toMatchObject({ category: 'ValidationError', code: 'VALIDATION_ERROR' });

    expect(state.documents).toHaveLength(0);
  });

  it('ingests an audio URL through the real policy and provider path (url branch)', async () => {
    vi.stubEnv('STORAGE_LOCAL_ALLOWED_MIME_TYPES', '*/*');
    await resetStoragePolicy();
    outbound.safeFetch.mockImplementation((url, options) =>
      outbound.actualSafeFetch(url, options, {
        lookup: async () => [{ address: '93.184.216.34', family: 4 }],
        fetch: async (requestUrl: string, init: any, pin: any) => {
          expect(requestUrl).toBe('https://example.test/voicemail.wav');
          expect(pin).toEqual({ address: '93.184.216.34', family: 4 });
          expect(init.redirect).toBe('manual');
          return new Response(wavBytes, { status: 200, headers: { 'content-type': 'audio/wav' } });
        },
      })
    );

    const { attachDocumentToTicket } = await import('../businessOperations/shared');
    const result = await attachDocumentToTicket(ctx, tx, ticketId, {
      source: { url: 'https://example.test/voicemail.wav' },
      filename: 'voicemail.wav',
    });

    expect(uploadMock).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ filename: 'voicemail.wav', content_type: 'audio/wav' });
    expect(state.externalFiles).toHaveLength(1);
    expect(state.externalFiles[0]).toMatchObject({
      mime_type: 'audio/wav',
      file_size: wavBytes.length,
      original_name: 'voicemail.wav',
    });
    expect(state.externalFiles[0].storage_path).toContain('tenant-1');
    expect(state.documents).toHaveLength(1);
    expect(state.associations).toHaveLength(1);
    const fetchOptions = outbound.safeFetch.mock.calls[0]?.[1] as { maxBytes: number; hostPolicy: (host: string) => boolean };
    expect(fetchOptions.maxBytes).toEqual(expect.any(Number));
    expect(fetchOptions.hostPolicy('EXAMPLE.TEST.')).toBe(true);
    expect(fetchOptions.hostPolicy('other.test')).toBe(false);
  });

  it('rejects a tenant-prohibited initial host before outbound requests or persistence', async () => {
    vi.stubEnv('STORAGE_LOCAL_ALLOWED_MIME_TYPES', '*/*');
    await resetStoragePolicy();
    const transport = vi.fn(async () => new Response(wavBytes));
    const lookup = vi.fn(async () => [{ address: '93.184.216.34', family: 4 }]);
    outbound.safeFetch.mockImplementation((url, options) =>
      outbound.actualSafeFetch(url, options, {
        lookup,
        fetch: transport,
      })
    );

    const { attachDocumentToTicket } = await import('../businessOperations/shared');
    await expect(attachDocumentToTicket(ctx, tx, ticketId, {
      source: { url: 'https://prohibited.test/file.wav' },
    })).rejects.toMatchObject({
      category: 'ValidationError', code: 'VALIDATION_ERROR',
      details: { hostname: 'prohibited.test', via_redirect: false },
    });

    expect(lookup).not.toHaveBeenCalled();
    expect(transport).not.toHaveBeenCalled();
    expect(uploadMock).not.toHaveBeenCalled();
    expect(state.externalFiles).toHaveLength(0);
    expect(state.documents).toHaveLength(0);
    expect(state.associations).toHaveLength(0);
  });

  it('uses only built-ins when a tenant has no policy rows', async () => {
    vi.stubEnv('STORAGE_LOCAL_ALLOWED_MIME_TYPES', '*/*');
    await resetStoragePolicy();
    state.fetchHosts['tenant-1'] = [];
    const transport = vi.fn(async (url: string) => {
      expect(url).toBe('https://files.oaiusercontent.com/builtin.wav');
      return new Response(wavBytes, { headers: { 'content-type': 'audio/wav' } });
    });
    outbound.safeFetch.mockImplementation((url, options) =>
      outbound.actualSafeFetch(url, options, {
        lookup: async () => [{ address: '93.184.216.34', family: 4 }],
        fetch: transport,
      })
    );
    const { attachDocumentToTicket } = await import('../businessOperations/shared');

    await expect(attachDocumentToTicket(ctx, tx, ticketId, {
      source: { url: 'https://files.oaiusercontent.com/builtin.wav' }, filename: 'builtin.wav',
    })).resolves.toMatchObject({ filename: 'builtin.wav' });
    await expect(attachDocumentToTicket(ctx, tx, ticketId, {
      source: { url: 'https://PROHIBITED.example.test/denied.wav' }, filename: 'denied.wav',
    })).rejects.toMatchObject({ category: 'ValidationError', code: 'VALIDATION_ERROR' });

    expect(transport).toHaveBeenCalledOnce();
    expect(state.externalFiles).toHaveLength(1);
    expect(state.documents).toHaveLength(1);
    expect(state.associations).toHaveLength(1);
  });

  it('matches wildcard tenant entries after case and trailing-dot normalization', async () => {
    vi.stubEnv('STORAGE_LOCAL_ALLOWED_MIME_TYPES', '*/*');
    await resetStoragePolicy();
    state.fetchHosts['tenant-1'] = [{ kind: 'custom', host_pattern: '*.example.test' }];
    const transport = vi.fn(async (url: string) => {
      expect(url).toBe('https://files.example.test./normalized.wav');
      return new Response(wavBytes, { headers: { 'content-type': 'audio/wav' } });
    });
    outbound.safeFetch.mockImplementation((url, options) =>
      outbound.actualSafeFetch(url, options, {
        lookup: async () => [{ address: '93.184.216.34', family: 4 }],
        fetch: transport,
      })
    );
    const { attachDocumentToTicket } = await import('../businessOperations/shared');

    await expect(attachDocumentToTicket(ctx, tx, ticketId, {
      source: { url: 'https://FILES.EXAMPLE.TEST./normalized.wav' }, filename: 'normalized.wav',
    })).resolves.toMatchObject({ filename: 'normalized.wav' });

    expect(transport).toHaveBeenCalledOnce();
    expect(state.documents).toHaveLength(1);
    expect(state.associations).toHaveLength(1);
  });

  it('honors a tenant disabling a built-in without affecting other tenants', async () => {
    vi.stubEnv('STORAGE_LOCAL_ALLOWED_MIME_TYPES', '*/*');
    await resetStoragePolicy();
    state.fetchHosts['tenant-1'] = [{ kind: 'builtin_disabled', host_pattern: 'files.oaiusercontent.com' }];
    state.fetchHosts['tenant-2'] = [];
    const lookup = vi.fn(async () => [{ address: '93.184.216.34', family: 4 }]);
    const transport = vi.fn(async () => new Response(wavBytes, { headers: { 'content-type': 'audio/wav' } }));
    outbound.safeFetch.mockImplementation((url, options) =>
      outbound.actualSafeFetch(url, options, { lookup, fetch: transport })
    );
    const { attachDocumentToTicket } = await import('../businessOperations/shared');
    const input = { source: { url: 'https://files.oaiusercontent.com/builtin.wav' }, filename: 'builtin.wav' };

    await expect(attachDocumentToTicket(ctx, tx, ticketId, input)).rejects.toMatchObject({
      category: 'ValidationError', code: 'VALIDATION_ERROR',
      details: { hostname: 'files.oaiusercontent.com', via_redirect: false },
    });
    expect(lookup).not.toHaveBeenCalled();
    expect(transport).not.toHaveBeenCalled();
    expect(uploadMock).not.toHaveBeenCalled();
    expect(state.externalFiles).toHaveLength(0);
    expect(state.documents).toHaveLength(0);
    expect(state.associations).toHaveLength(0);

    await expect(attachDocumentToTicket(ctx, { ...tx, tenantId: 'tenant-2' }, ticketId, input))
      .resolves.toMatchObject({ filename: 'builtin.wav' });
    expect(transport).toHaveBeenCalledOnce();
    expect(uploadMock).toHaveBeenCalledOnce();
    expect(state.externalFiles).toHaveLength(1);
    expect(state.documents).toHaveLength(1);
    expect(state.associations).toHaveLength(1);
  });

  it.each([1, 2, 3])('rejects a prohibited public host at redirect %i before DNS, requests or persistence', async (deniedHop) => {
    vi.stubEnv('STORAGE_LOCAL_ALLOWED_MIME_TYPES', '*/*');
    await resetStoragePolicy();
    const allowedHosts = ['example.test', 'files.example.test', 'cdn.example.test'];
    state.fetchHosts['tenant-1'] = allowedHosts.map((host_pattern) => ({ kind: 'custom', host_pattern }));
    const allowedUrls = allowedHosts.slice(0, deniedHop).map((host) => `https://${host}/redirect.wav`);
    const lookup = vi.fn(async () => [{ address: '93.184.216.34', family: 4 }]);
    const requested: string[] = [];
    const transport = vi.fn(async (url: string) => {
      requested.push(url);
      if (url === 'https://prohibited.test/file.wav') {
        return new Response(wavBytes, { headers: { 'content-type': 'audio/wav' } });
      }
      const location = allowedUrls[requested.length] ?? 'https://prohibited.test/file.wav';
      return new Response(null, { status: 302, headers: { location } });
    });
    outbound.safeFetch.mockImplementation((url, options) =>
      outbound.actualSafeFetch(url, options, {
        lookup,
        fetch: transport,
      })
    );

    const { attachDocumentToTicket } = await import('../businessOperations/shared');
    await expect(attachDocumentToTicket(ctx, tx, ticketId, {
      source: { url: 'https://example.test/redirect.wav' },
    })).rejects.toMatchObject({
      category: 'ValidationError', code: 'VALIDATION_ERROR',
      details: { hostname: 'prohibited.test', via_redirect: true },
    });

    expect(lookup.mock.calls).toEqual(allowedHosts.slice(0, deniedHop).map((host) => [host]));
    expect(requested).toEqual(allowedUrls);
    expect(uploadMock).not.toHaveBeenCalled();
    expect(state.externalFiles).toHaveLength(0);
    expect(state.documents).toHaveLength(0);
    expect(state.associations).toHaveLength(0);
  });

  it('follows an allowed redirect chain within the shared redirect limit and persists it', async () => {
    vi.stubEnv('STORAGE_LOCAL_ALLOWED_MIME_TYPES', '*/*');
    await resetStoragePolicy();
    state.fetchHosts['tenant-1'] = [
      { kind: 'custom', host_pattern: 'example.test' },
      { kind: 'custom', host_pattern: 'files.example.test' },
      { kind: 'custom', host_pattern: 'cdn.example.test' },
      { kind: 'custom', host_pattern: 'download.example.test' },
    ];
    const requested: string[] = [];
    const transport = vi.fn(async (url: string) => {
      requested.push(url);
      if (url === 'https://example.test/start.wav') {
        return new Response(null, { status: 302, headers: { location: 'https://files.example.test/end.wav' } });
      }
      if (url === 'https://files.example.test/end.wav') {
        return new Response(null, { status: 302, headers: { location: 'https://cdn.example.test/next.wav' } });
      }
      if (url === 'https://cdn.example.test/next.wav') {
        return new Response(null, { status: 302, headers: { location: 'https://download.example.test/final.wav' } });
      }
      return new Response(wavBytes, { status: 200, headers: { 'content-type': 'audio/wav' } });
    });
    outbound.safeFetch.mockImplementation((url, options) =>
      outbound.actualSafeFetch(url, options, {
        lookup: async () => [{ address: '93.184.216.34', family: 4 }],
        fetch: transport,
      })
    );

    const { attachDocumentToTicket } = await import('../businessOperations/shared');
    const result = await attachDocumentToTicket(ctx, tx, ticketId, {
      source: { url: 'https://example.test/start.wav' }, filename: 'final.wav',
    });

    expect(requested).toEqual([
      'https://example.test/start.wav',
      'https://files.example.test/end.wav',
      'https://cdn.example.test/next.wav',
      'https://download.example.test/final.wav',
    ]);
    expect(result.filename).toBe('final.wav');
    expect(state.externalFiles).toHaveLength(1);
    expect(state.documents).toHaveLength(1);
    expect(state.associations).toHaveLength(1);
  });

  it('selects the host policy by tenant so one tenant can allow a host another rejects', async () => {
    vi.stubEnv('STORAGE_LOCAL_ALLOWED_MIME_TYPES', '*/*');
    await resetStoragePolicy();
    state.fetchHosts['tenant-1'] = [{ kind: 'custom', host_pattern: 'shared.example.test' }];
    state.fetchHosts['tenant-2'] = [{ kind: 'custom', host_pattern: 'other.example.test' }];
    const transport = vi.fn(async () => new Response(wavBytes, { headers: { 'content-type': 'audio/wav' } }));
    outbound.safeFetch.mockImplementation((url, options) =>
      outbound.actualSafeFetch(url, options, {
        lookup: async () => [{ address: '93.184.216.34', family: 4 }],
        fetch: transport,
      })
    );
    const { attachDocumentToTicket } = await import('../businessOperations/shared');

    await attachDocumentToTicket(ctx, tx, ticketId, {
      source: { url: 'https://shared.example.test/file.wav' }, filename: 'allowed.wav',
    });
    await expect(attachDocumentToTicket(ctx, { ...tx, tenantId: 'tenant-2' }, ticketId, {
      source: { url: 'https://shared.example.test/file.wav' }, filename: 'rejected.wav',
    })).rejects.toMatchObject({ category: 'ValidationError', code: 'VALIDATION_ERROR' });

    expect(transport).toHaveBeenCalledOnce();
    expect(state.externalFiles).toHaveLength(1);
    expect(state.documents).toHaveLength(1);
    expect(state.associations).toHaveLength(1);
  });

  it('fails closed when the tenant policy lookup fails, before transport or persistence', async () => {
    vi.stubEnv('STORAGE_LOCAL_ALLOWED_MIME_TYPES', '*/*');
    await resetStoragePolicy();
    state.fetchHostLookupError = new Error('policy store unavailable');
    const transport = vi.fn(async () => new Response(wavBytes));
    outbound.safeFetch.mockImplementation((url, options) =>
      outbound.actualSafeFetch(url, options, {
        lookup: async () => [{ address: '93.184.216.34', family: 4 }],
        fetch: transport,
      })
    );
    const { attachDocumentToTicket } = await import('../businessOperations/shared');

    await expect(attachDocumentToTicket(ctx, tx, ticketId, {
      source: { url: 'https://example.test/file.wav' },
    })).rejects.toMatchObject({ category: 'TransientError', code: 'TRANSIENT_FAILURE' });

    expect(outbound.safeFetch).not.toHaveBeenCalled();
    expect(transport).not.toHaveBeenCalled();
    expect(uploadMock).not.toHaveBeenCalled();
    expect(state.externalFiles).toHaveLength(0);
    expect(state.documents).toHaveLength(0);
    expect(state.associations).toHaveLength(0);
  });

  it('does not let a malformed tenant host pattern authorize an outbound request', async () => {
    vi.stubEnv('STORAGE_LOCAL_ALLOWED_MIME_TYPES', '*/*');
    await resetStoragePolicy();
    state.fetchHosts['tenant-1'] = [{ kind: 'custom', host_pattern: '**.example.test' }];
    const transport = vi.fn(async () => new Response(wavBytes));
    outbound.safeFetch.mockImplementation((url, options) =>
      outbound.actualSafeFetch(url, options, {
        lookup: async () => [{ address: '93.184.216.34', family: 4 }],
        fetch: transport,
      })
    );
    const { attachDocumentToTicket } = await import('../businessOperations/shared');

    await expect(attachDocumentToTicket(ctx, tx, ticketId, {
      source: { url: 'https://files.example.test/file.wav' },
    })).rejects.toMatchObject({ category: 'ValidationError', code: 'VALIDATION_ERROR' });

    expect(transport).not.toHaveBeenCalled();
    expect(uploadMock).not.toHaveBeenCalled();
    expect(state.externalFiles).toHaveLength(0);
    expect(state.documents).toHaveLength(0);
    expect(state.associations).toHaveLength(0);
  });

  it('does not upload or associate a URL resolving to a private address', async () => {
    vi.stubEnv('STORAGE_LOCAL_ALLOWED_MIME_TYPES', '*/*');
    await resetStoragePolicy();
    outbound.safeFetch.mockImplementation((url, options) =>
      outbound.actualSafeFetch(url, options, {
        lookup: async () => [{ address: '10.0.0.7', family: 4 }],
        fetch: vi.fn(async () => new Response(wavBytes)),
      })
    );

    const { attachDocumentToTicket } = await import('../businessOperations/shared');
    await expect(
      attachDocumentToTicket(ctx, tx, ticketId, { source: { url: 'https://example.test/private.wav' } })
    ).rejects.toMatchObject({ category: 'ValidationError', code: 'VALIDATION_ERROR' });

    expect(uploadMock).not.toHaveBeenCalled();
    expect(state.externalFiles).toHaveLength(0);
    expect(state.documents).toHaveLength(0);
    expect(state.associations).toHaveLength(0);
  });

  it('rejects an unsafe IPv6 literal before transport or attachment persistence', async () => {
    vi.stubEnv('STORAGE_LOCAL_ALLOWED_MIME_TYPES', '*/*');
    await resetStoragePolicy();
    const transport = vi.fn(async () => new Response(wavBytes));
    outbound.safeFetch.mockImplementation((url, options) =>
      outbound.actualSafeFetch(url, options, {
        lookup: async () => [{ address: '93.184.216.34', family: 4 }],
        fetch: transport,
      })
    );

    const { attachDocumentToTicket } = await import('../businessOperations/shared');
    await expect(
      attachDocumentToTicket(ctx, tx, ticketId, { source: { url: 'https://[fec0::1]/private.wav' } })
    ).rejects.toMatchObject({
      category: 'ValidationError', code: 'VALIDATION_ERROR',
      details: { hostname: 'fec0::1', via_redirect: false },
    });

    expect(transport).not.toHaveBeenCalled();
    expect(uploadMock).not.toHaveBeenCalled();
    expect(state.externalFiles).toHaveLength(0);
    expect(state.documents).toHaveLength(0);
    expect(state.associations).toHaveLength(0);
  });

  it('rejects a DNS answer in the local-use translation prefix before persistence', async () => {
    vi.stubEnv('STORAGE_LOCAL_ALLOWED_MIME_TYPES', '*/*');
    await resetStoragePolicy();
    state.fetchHosts['tenant-1'].push({ kind: 'custom', host_pattern: 'dns.example.test' });
    const transport = vi.fn(async () => new Response(wavBytes));
    outbound.safeFetch.mockImplementation((url, options) =>
      outbound.actualSafeFetch(url, options, {
        lookup: async () => [{ address: '64:ff9b:1::a00:1', family: 6 }],
        fetch: transport,
      })
    );

    const { attachDocumentToTicket } = await import('../businessOperations/shared');
    await expect(
      attachDocumentToTicket(ctx, tx, ticketId, { source: { url: 'https://dns.example.test/private.wav' } })
    ).rejects.toMatchObject({
      category: 'ValidationError', code: 'VALIDATION_ERROR',
      message: 'URL resolved to a private or reserved address',
    });

    expect(transport).not.toHaveBeenCalled();
    expect(uploadMock).not.toHaveBeenCalled();
    expect(state.externalFiles).toHaveLength(0);
    expect(state.documents).toHaveLength(0);
    expect(state.associations).toHaveLength(0);
  });

  it('rejects an allowed redirect host resolving to nonpublic IPv6 before fetching or persisting its response', async () => {
    vi.stubEnv('STORAGE_LOCAL_ALLOWED_MIME_TYPES', '*/*');
    await resetStoragePolicy();
    state.fetchHosts['tenant-1'].push({ kind: 'custom', host_pattern: 'ipv6.example.test' });
    const transport = vi.fn(async (_url: string) => new Response(null, {
      status: 302,
      headers: { location: 'https://ipv6.example.test/private.wav' },
    }));
    outbound.safeFetch.mockImplementation((url, options) =>
      outbound.actualSafeFetch(url, options, {
        lookup: async (host: string) => host === 'ipv6.example.test'
          ? [{ address: 'fec0::1', family: 6 }]
          : [{ address: '93.184.216.34', family: 4 }],
        fetch: transport,
      })
    );

    const { attachDocumentToTicket } = await import('../businessOperations/shared');
    await expect(
      attachDocumentToTicket(ctx, tx, ticketId, { source: { url: 'https://example.test/redirect.wav' } })
    ).rejects.toMatchObject({
      category: 'ValidationError', code: 'VALIDATION_ERROR',
      message: 'URL resolved to a private or reserved address',
    });

    expect(transport).toHaveBeenCalledOnce();
    expect(transport.mock.calls[0]![0]).toBe('https://example.test/redirect.wav');
    expect(uploadMock).not.toHaveBeenCalled();
    expect(state.externalFiles).toHaveLength(0);
    expect(state.documents).toHaveLength(0);
    expect(state.associations).toHaveLength(0);
  });

  it('does not persist a streamed response that crosses the configured cap', async () => {
    vi.stubEnv('STORAGE_LOCAL_ALLOWED_MIME_TYPES', '*/*');
    await resetStoragePolicy();
    outbound.safeFetch.mockImplementation((url, options) =>
      outbound.actualSafeFetch(url, { ...options, maxBytes: 32 }, {
        lookup: async () => [{ address: '93.184.216.34', family: 4 }],
        fetch: async () => new Response(new ReadableStream<Uint8Array>({
          pull(controller) { controller.enqueue(new Uint8Array(33)); },
        })),
      })
    );

    const { attachDocumentToTicket } = await import('../businessOperations/shared');
    await expect(
      attachDocumentToTicket(ctx, tx, ticketId, { source: { url: 'https://example.test/large.wav' } })
    ).rejects.toMatchObject({ category: 'ValidationError', code: 'VALIDATION_ERROR' });

    expect(uploadMock).not.toHaveBeenCalled();
    expect(state.externalFiles).toHaveLength(0);
    expect(state.documents).toHaveLength(0);
    expect(state.associations).toHaveLength(0);
  });

  it('rejects a disallowed MIME from a fetched URL through the real policy (url branch)', async () => {
    vi.stubEnv('STORAGE_LOCAL_ALLOWED_MIME_TYPES', 'application/pdf');
    await resetStoragePolicy();
    outbound.safeFetch.mockResolvedValue({
      bytes: wavBytes,
      headers: new Headers({ 'content-type': 'audio/wav' }),
    });

    const { attachDocumentToTicket } = await import('../businessOperations/shared');

    await expect(
      attachDocumentToTicket(ctx, tx, ticketId, { source: { url: 'https://example.test/voicemail.wav' } })
    ).rejects.toMatchObject({ category: 'ValidationError', code: 'VALIDATION_ERROR' });

    expect(uploadMock).not.toHaveBeenCalled();
    expect(state.externalFiles).toHaveLength(0);
  });

  it('persists no file or document when the streaming fetch rejects an oversized body', async () => {
    vi.stubEnv('STORAGE_LOCAL_ALLOWED_MIME_TYPES', '*/*');
    await resetStoragePolicy();
    const { UrlFetchError } = await import('../../../../lib/net/safeFetch');
    outbound.safeFetch.mockRejectedValue(new UrlFetchError('too_large', 'Download exceeded limit'));

    const { attachDocumentToTicket } = await import('../businessOperations/shared');
    await expect(
      attachDocumentToTicket(ctx, tx, ticketId, { source: { url: 'https://example.test/large.wav' } })
    ).rejects.toMatchObject({ category: 'ValidationError', code: 'VALIDATION_ERROR' });

    expect(uploadMock).not.toHaveBeenCalled();
    expect(state.externalFiles).toHaveLength(0);
    expect(state.documents).toHaveLength(0);
    expect(state.associations).toHaveLength(0);
  });
});
