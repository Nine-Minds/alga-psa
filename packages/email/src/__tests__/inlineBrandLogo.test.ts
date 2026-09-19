import { beforeEach, describe, expect, it, vi } from 'vitest';

const download = vi.fn(async () => Buffer.from('logo-bytes'));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: vi.fn(async () => { throw new Error('the caller must pass its own knex'); }),
  runWithTenant: (_tenant: string, fn: () => Promise<any>) => fn(),
  tenantDb: (knex: any, tenant: string) => knex.forTenant(tenant),
}));

vi.mock('@alga-psa/storage/models/storage', () => ({
  FileStoreModel: {
    findById: vi.fn(async (knex: any, fileId: string) => knex.files[fileId] ?? null),
  },
}));

vi.mock('@alga-psa/storage/StorageProviderFactory', () => ({
  StorageProviderFactory: {
    createProvider: vi.fn(async () => ({ download })),
  },
}));

import { applyBrandLogo } from '../branding';
import { clearBrandLogoCache, embedBrandLogo } from '../inlineBrandLogo';

const TENANT = 'tenant-1';

interface FakeRows {
  associations?: Array<Record<string, any>>;
  documents?: Array<Record<string, any>>;
  tenant_settings?: Array<Record<string, any>>;
}

const matches = (row: Record<string, any>, where: Record<string, any>) =>
  Object.entries(where).every(([column, value]) => row[column] === value);

/** Just enough knex to answer the three reads the pass makes. */
function fakeKnex(rows: FakeRows, files: Record<string, any> = {}) {
  const tables: Record<string, Array<Record<string, any>>> = {
    document_associations: rows.associations ?? [],
    documents: rows.documents ?? [],
    tenant_settings: rows.tenant_settings ?? [],
  };
  const reads: string[] = [];

  const builder = (table: string) => {
    let where: Record<string, any> = {};
    const chain: any = {
      where(criteria: Record<string, any>) {
        where = { ...where, ...criteria };
        return chain;
      },
      select() {
        return chain;
      },
      async first() {
        reads.push(table);
        return (tables[table] ?? []).find((row) => matches(row, where)) ?? undefined;
      },
    };
    return chain;
  };

  return {
    files,
    reads,
    forTenant: (tenant: string) => {
      expect(tenant).toBe(TENANT);
      return { table: builder };
    },
  };
}

const logoRows = (variant: string): FakeRows => ({
  associations: [{
    entity_id: TENANT,
    entity_type: 'tenant',
    is_entity_logo: true,
    entity_logo_variant: variant,
    document_id: `doc-${variant}`,
  }],
  documents: [{ document_id: `doc-${variant}`, file_id: `file-${variant}` }],
});

const files = (variant: string, size = 2048, mimeType = 'image/png') => ({
  [`file-${variant}`]: {
    file_id: `file-${variant}`,
    storage_path: `/logos/${variant}.png`,
    mime_type: mimeType,
    file_size: size,
  },
});

describe('embedBrandLogo', () => {
  beforeEach(() => {
    clearBrandLogoCache();
    download.mockClear();
    download.mockResolvedValue(Buffer.from('logo-bytes'));
  });

  it('attaches the bytes for a tag already in the cid form', async () => {
    const html = applyBrandLogo('<body><h1>Hi</h1></body>', { variant: 'wide', alt: 'Acme' });
    const knex = fakeKnex(logoRows('wide'), files('wide'));

    const result = await embedBrandLogo(html, { tenantId: TENANT, knex: knex as any });

    expect(result.html).toContain('src="cid:alga-brand-logo-wide"');
    expect(result.attachments).toEqual([{
      filename: 'logo.png',
      content: Buffer.from('logo-bytes'),
      contentType: 'image/png',
      cid: 'alga-brand-logo-wide',
    }]);
  });

  it('rewrites a row written before the cid form using the saved variant', async () => {
    const html = '<body><img data-alga-brand-logo src="/api/documents/view/file-wide?t=7" alt="Acme"/></body>';
    const knex = fakeKnex(
      {
        ...logoRows('wide'),
        tenant_settings: [{ settings: { emailBranding: { logo: { variant: 'wide' } } } }],
      },
      files('wide'),
    );

    const result = await embedBrandLogo(html, { tenantId: TENANT, knex: knex as any });

    expect(result.html).toContain('src="cid:alga-brand-logo-wide"');
    expect(result.html).not.toContain('/api/documents/view/');
    expect(result.attachments).toHaveLength(1);
  });

  it('leaves an unbranded email alone without touching the database', async () => {
    const knex = fakeKnex({});

    const result = await embedBrandLogo('<body><h1>Hi</h1></body>', { tenantId: TENANT, knex: knex as any });

    expect(result).toEqual({ html: '<body><h1>Hi</h1></body>', attachments: [] });
    expect(knex.reads).toHaveLength(0);
    expect(download).not.toHaveBeenCalled();
  });

  it('falls back to the square logo when no wide one was uploaded', async () => {
    const html = applyBrandLogo('<body><h1>Hi</h1></body>', { variant: 'wide' });
    const knex = fakeKnex(logoRows('default'), files('default'));

    const result = await embedBrandLogo(html, { tenantId: TENANT, knex: knex as any });

    expect(result.html).toContain('src="cid:alga-brand-logo-wide"');
    expect(result.attachments[0]).toMatchObject({ cid: 'alga-brand-logo-wide' });
    expect(download).toHaveBeenCalledWith('/logos/default.png');
  });

  it('removes the placeholder when the tenant has no logo at all', async () => {
    const html = applyBrandLogo('<body><h1>Hi</h1></body>', { variant: 'default' });
    const knex = fakeKnex({});

    const result = await embedBrandLogo(html, { tenantId: TENANT, knex: knex as any });

    expect(result.html).not.toContain('data-alga-brand-logo');
    expect(result.html).toContain('<h1>Hi</h1>');
    expect(result.attachments).toHaveLength(0);
  });

  it('removes a logo over the 1 MB cap instead of mailing it to everyone', async () => {
    const html = applyBrandLogo('<body><h1>Hi</h1></body>', { variant: 'default' });
    const knex = fakeKnex(logoRows('default'), files('default', 4 * 1024 * 1024));

    const result = await embedBrandLogo(html, { tenantId: TENANT, knex: knex as any });

    expect(result.html).not.toContain('data-alga-brand-logo');
    expect(result.attachments).toHaveLength(0);
    expect(download).not.toHaveBeenCalled();
  });

  it('reads storage once for a fan-out of messages', async () => {
    const html = applyBrandLogo('<body><h1>Hi</h1></body>', { variant: 'default' });
    const knex = fakeKnex(logoRows('default'), files('default'));

    for (let index = 0; index < 5; index += 1) {
      const result = await embedBrandLogo(html, { tenantId: TENANT, knex: knex as any });
      expect(result.attachments).toHaveLength(1);
    }

    expect(download).toHaveBeenCalledTimes(1);
    expect(knex.reads).toEqual(['document_associations', 'documents']);
  });

  it('removes an SVG logo, which no mail client renders', async () => {
    const html = applyBrandLogo('<body><h1>Hi</h1></body>', { variant: 'default' });
    const knex = fakeKnex(logoRows('default'), files('default', 2048, 'image/svg+xml'));

    const result = await embedBrandLogo(html, { tenantId: TENANT, knex: knex as any });

    expect(result.html).not.toContain('data-alga-brand-logo');
    expect(result.attachments).toHaveLength(0);
    expect(download).not.toHaveBeenCalled();
  });

  it('rewrites a single-quoted src instead of adding a second one', async () => {
    const html = "<body><img data-alga-brand-logo src='cid:alga-brand-logo-wide' alt='Acme'/></body>";
    const knex = fakeKnex(logoRows('wide'), files('wide'));

    const result = await embedBrandLogo(html, { tenantId: TENANT, knex: knex as any });

    expect(result.html).toContain('src="cid:alga-brand-logo-wide"');
    expect(result.html.match(/src=/g)).toHaveLength(1);
    expect(result.attachments).toHaveLength(1);
  });

  it('expires a miss far sooner than a hit, so a fresh upload shows up', async () => {
    vi.useFakeTimers();
    try {
      const html = applyBrandLogo('<body><h1>Hi</h1></body>', { variant: 'default' });
      const empty = fakeKnex({});

      expect((await embedBrandLogo(html, { tenantId: TENANT, knex: empty as any })).attachments).toHaveLength(0);

      // Inside the miss TTL the lookup is not repeated...
      vi.advanceTimersByTime(20 * 1000);
      await embedBrandLogo(html, { tenantId: TENANT, knex: empty as any });
      expect(empty.reads).toEqual(['document_associations']);

      // ...but the tenant who just uploaded a logo does not wait out the hit TTL.
      vi.advanceTimersByTime(45 * 1000);
      const uploaded = fakeKnex(logoRows('default'), files('default'));
      const result = await embedBrandLogo(html, { tenantId: TENANT, knex: uploaded as any });

      expect(result.attachments).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('sends without the logo rather than failing when the lookup throws', async () => {
    const html = applyBrandLogo('<body><h1>Hi</h1></body>', { variant: 'default' });
    const knex = fakeKnex(logoRows('default'), files('default'));
    download.mockRejectedValueOnce(new Error('storage unavailable'));

    const result = await embedBrandLogo(html, { tenantId: TENANT, knex: knex as any });

    expect(result.html).not.toContain('data-alga-brand-logo');
    expect(result.html).toContain('<h1>Hi</h1>');
    expect(result.attachments).toHaveLength(0);
  });

  it('reads the saved variant of a legacy row once, not once per message', async () => {
    const html = '<body><img data-alga-brand-logo src="/api/documents/view/file-default?t=7"/></body>';
    const knex = fakeKnex(
      { ...logoRows('default'), tenant_settings: [{ settings: {} }] },
      files('default'),
    );

    for (let index = 0; index < 5; index += 1) {
      await embedBrandLogo(html, { tenantId: TENANT, knex: knex as any });
    }

    expect(knex.reads.filter((table) => table === 'tenant_settings')).toHaveLength(1);
  });
});
