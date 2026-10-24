import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createFakeDb, TENANT, INTEGRATION_ID } from './dattoFakeDb';

let db: ReturnType<typeof createFakeDb>;
let sites: any[] = [];

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: vi.fn(async () => ({ knex: db.knex })),
  tenantDb: (conn: any, _tenant: string) => ({ table: (t: string) => conn.__table(t) }),
}));

vi.mock('@alga-psa/core/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('@alga-psa/event-bus/publishers', () => ({ publishEvent: vi.fn(async () => undefined) }));

vi.mock('@ee/lib/integrations/datto/buildClient', () => ({
  getDattoIntegrationRow: vi.fn(async () => db.tables.rmm_integrations[0]),
  buildDattoClientForTenant: vi.fn(async () => ({ listSites: async () => sites })),
}));

vi.mock('@alga-psa/shared/rmm/sharedAssetIngestionService', () => ({
  ingestNormalizedRmmDeviceSnapshot: vi.fn(),
}));

import {
  buildClientNameIndex,
  looseClientNameKey,
  runDattoRmmSiteSync,
  suggestClientForDattoSite,
} from '@ee/lib/integrations/datto/siteSync';

const mappingFor = (uid: string) => db.tables.rmm_organization_mappings.find((m) => m.external_organization_id === uid)!;

describe('Datto site -> client suggestion', () => {
  beforeEach(() => {
    db = createFakeDb({
      rmm_integrations: [{ integration_id: INTEGRATION_ID, provider: 'datto', is_active: true, settings: {} }],
      rmm_organization_mappings: [],
      clients: [
        { client_id: 'c-acme', client_name: 'Acme Corporation' },
        { client_id: 'c-globex', client_name: 'Globex' },
        { client_id: 'c-dup-1', client_name: 'Twin Co' },
        { client_id: 'c-dup-2', client_name: 'twin co' },
      ],
    });
  });

  it('prefers the Autotask company name over the site name', async () => {
    sites = [{ uid: 's1', name: 'Globex', autotaskCompanyName: 'acme corporation' }];
    await runDattoRmmSiteSync({ tenant: TENANT });
    expect(mappingFor('s1').metadata).toMatchObject({
      suggested_client_id: 'c-acme',
      suggested_client_name: 'Acme Corporation',
    });
  });

  it('falls back to the site name, case-insensitively and exactly', async () => {
    sites = [
      { uid: 's2', name: '  GLOBEX ', autotaskCompanyName: 'No Such Company' },
      { uid: 's3', name: 'Globex Industries' },
    ];
    await runDattoRmmSiteSync({ tenant: TENANT });
    expect(mappingFor('s2').metadata).toMatchObject({ suggested_client_id: 'c-globex', suggested_client_name: 'Globex' });
    // Exact match only: a prefix is not a match.
    expect(mappingFor('s3').metadata.suggested_client_id).toBeNull();
  });

  it('suggests nothing for an ambiguous name', async () => {
    sites = [{ uid: 's4', name: 'Twin Co' }];
    await runDattoRmmSiteSync({ tenant: TENANT });
    expect(mappingFor('s4').metadata.suggested_client_id).toBeNull();
  });

  it('never assigns the client, only suggests it', async () => {
    sites = [{ uid: 's1', name: 'Globex' }];
    await runDattoRmmSiteSync({ tenant: TENANT });
    expect(mappingFor('s1').client_id).toBeUndefined();
    expect(mappingFor('s1').metadata.suggested_client_id).toBe('c-globex');

    // Not even on a rerun, and not once the suggestion changes.
    db.tables.clients.push({ client_id: 'c-new', client_name: 'Brand New' });
    sites = [{ uid: 's1', name: 'Brand New' }];
    await runDattoRmmSiteSync({ tenant: TENANT });
    expect(mappingFor('s1').client_id).toBeUndefined();
    expect(mappingFor('s1').metadata).toMatchObject({ suggested_client_id: 'c-new', suggested_client_name: 'Brand New' });
  });

  it('does not override a client the admin already chose', async () => {
    sites = [{ uid: 's1', name: 'Globex' }];
    await runDattoRmmSiteSync({ tenant: TENANT });
    mappingFor('s1').client_id = 'c-acme';
    await runDattoRmmSiteSync({ tenant: TENANT });
    expect(mappingFor('s1').client_id).toBe('c-acme');
  });

  it('clears a stale suggestion when the match disappears', async () => {
    sites = [{ uid: 's1', name: 'Globex' }];
    await runDattoRmmSiteSync({ tenant: TENANT });
    sites = [{ uid: 's1', name: 'Renamed Elsewhere' }];
    await runDattoRmmSiteSync({ tenant: TENANT });
    expect(mappingFor('s1').metadata.suggested_client_id).toBeNull();
    expect(mappingFor('s1').metadata.suggested_client_name).toBeNull();
  });
});

describe('suggestClientForDattoSite', () => {
  const index = buildClientNameIndex([{ client_id: 'c1', client_name: 'Acme' }]);

  it('returns null without candidates', () => {
    expect(suggestClientForDattoSite({}, index)).toBeNull();
    expect(suggestClientForDattoSite({ name: '', autotaskCompanyName: null }, index)).toBeNull();
  });

  it('matches the site name when no Autotask company is set', () => {
    expect(suggestClientForDattoSite({ name: 'ACME' }, index)).toEqual({ clientId: 'c1', clientName: 'Acme' });
  });

  it('falls back to a loose match that ignores punctuation, "the" and legal suffixes', () => {
    expect(suggestClientForDattoSite({ name: 'The Acme Company, LLC' }, index)).toEqual({ clientId: 'c1', clientName: 'Acme' });
    expect(suggestClientForDattoSite({ name: 'Acme Holdings' }, index)).toBeNull();
  });

  it('prefers an exact match on either name over a loose one', () => {
    const both = buildClientNameIndex([
      { client_id: 'c-inc', client_name: 'Acme Inc' },
      { client_id: 'c-plain', client_name: 'Acme Plumbing' },
    ]);
    expect(suggestClientForDattoSite({ autotaskCompanyName: 'Acme, Inc.', name: 'Acme Plumbing' }, both))
      .toEqual({ clientId: 'c-plain', clientName: 'Acme Plumbing' });
  });

  it('drops a loose key two clients share', () => {
    const twins = buildClientNameIndex([
      { client_id: 'c-1', client_name: 'Acme Inc' },
      { client_id: 'c-2', client_name: 'Acme LLC' },
    ]);
    expect(suggestClientForDattoSite({ name: 'Acme' }, twins)).toBeNull();
  });
});

describe('looseClientNameKey', () => {
  it('normalizes the forms PSA and RMM names commonly differ in', () => {
    expect(looseClientNameKey('Smith & Sons, Ltd.')).toBe('smith and sons');
    expect(looseClientNameKey('  The   Dental-Group P.C. ')).toBe('dental group p c');
    expect(looseClientNameKey('Inc')).toBe('inc');
    expect(looseClientNameKey('Zahnärzte GmbH')).toBe('zahnärzte');
  });
});
