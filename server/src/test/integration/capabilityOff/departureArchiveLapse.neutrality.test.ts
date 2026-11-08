import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * CM L7a neutrality. With the Kansas flag off, or the Emerald flag on without entitlement, or the
 * kill switch (FORCE_CAPABILITIES=co-managed:off), the departure/archive entry points are absent
 * (refused before any database work) and the lapse reader is never consulted by write admission.
 * A participating tenant proves the same harness does reach the body, so the refusals are not vacuous.
 */
const touched = vi.hoisted(() => ({ knex: [] as string[], departed: vi.fn(), listed: vi.fn(), fileRead: vi.fn() }));

vi.mock('@alga-psa/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@alga-psa/db')>()),
  createTenantKnex: async () => ({ knex: new Proxy(function () {}, { get(_t, p) { touched.knex.push(String(p)); throw new Error('knex used'); } }), tenant: 'tenant-1' }),
}));
vi.mock('@alga-psa/auth', () => ({
  withAuth: (action: any) => async (...args: unknown[]) => action({ id: 'user-1', user_type: 'internal' }, { tenant: 'tenant-1' }, ...args),
  getSession: async () => ({ session_id: 's-1', user: { id: 'user-1', tenant: 'tenant-1', user_type: 'internal' } }),
}));
vi.mock('@alga-psa/co-managed', () => ({
  CoManagedClosureError: class extends Error {},
  departCoManagedRelationship: touched.departed,
  getCoManagedDepartureScreen: touched.departed,
  listCoManagedArchives: touched.listed,
  getCoManagedArchiveHistory: touched.listed,
  readCoManagedArchiveFile: touched.fileRead,
  resolveCoManagedManagementTarget: vi.fn(),
  isCoManagedSharedWorkError: () => false,
  isCoManagedUuid: () => true,
}));
vi.mock('@/lib/co-managed/browserActor', () => ({ coManagedBrowserActor: async () => ({ kind: 'session', tenant: 'tenant-1', userId: 'user-1', sessionId: 's-1' }) }));
vi.mock('@alga-psa/licensing', () => ({ invalidateCoManagedAwaitingAcceptance: vi.fn() }));
vi.mock('../../../lib/co-managed/browserActor', () => ({ coManagedBrowserActor: async () => ({ kind: 'session', tenant: 'tenant-1', userId: 'user-1', sessionId: 's-1' }) }));

import { registerCapabilityParticipation } from '@alga-psa/core/capability';
import { clearCapabilityCache, resetCapabilityRegistry } from '@alga-psa/core/capability/testing';
import { createCoManagedWriteAdmissionResolver } from '../../../../../packages/licensing/src/lib/co-managed-write-admission';
import { getCoManagedDeparture, departFromCoManagedRelationship } from '../../../lib/actions/coManagedDepartureActions';
import { listCoManagedArchiveSummaries, getCoManagedArchive } from '../../../lib/actions/coManagedArchiveActions';
import { GET as archiveBytes } from '../../../app/api/co-management/archive-files/[archiveFileId]/route';

const UUID = '33333333-3333-4333-8333-333333333333';
const cases: Array<[string, () => Promise<unknown>]> = [
  ['getCoManagedDeparture', () => (getCoManagedDeparture as any)({})],
  ['departFromCoManagedRelationship', () => (departFromCoManagedRelationship as any)({ relationshipId: UUID, expectedRevision: 1 })],
  ['listCoManagedArchiveSummaries', () => (listCoManagedArchiveSummaries as any)(0)],
  ['getCoManagedArchive', () => (getCoManagedArchive as any)({ operationId: UUID })],
];

beforeEach(() => {
  delete process.env.FORCE_CAPABILITIES;
  resetCapabilityRegistry();
  touched.knex.length = 0;
  touched.departed.mockReset(); touched.listed.mockReset(); touched.fileRead.mockReset();
});

describe.each([
  ['Kansas (flag off, nothing participates)', () => undefined],
  ['Emerald (flag on, no entitlement)', () => registerCapabilityParticipation('co-managed', async () => new Set<string>())],
  ['participating tenant with FORCE_CAPABILITIES=co-managed:off', () => {
    registerCapabilityParticipation('co-managed', async ({ tenantIds }) => new Set(tenantIds));
    process.env.FORCE_CAPABILITIES = 'co-managed:off'; clearCapabilityCache();
  }],
])('%s', (_label, arrange) => {
  it.each(cases)('%s is refused before any database or domain work', async (_name, run) => {
    arrange();
    await expect(run()).rejects.toThrow();
    expect(touched.knex).toEqual([]);
    expect(touched.departed).not.toHaveBeenCalled();
    expect(touched.listed).not.toHaveBeenCalled();
  });

  it('the archive bytes route answers 404 and reads nothing', async () => {
    arrange();
    const response = await archiveBytes(new Request('http://x/api/co-management/archive-files/' + UUID), { params: Promise.resolve({ archiveFileId: UUID }) });
    expect(response.status).toBe(404);
    expect(touched.fileRead).not.toHaveBeenCalled();
    expect(touched.knex).toEqual([]);
  });
});

describe('write admission under the kill switch', () => {
  it('admits every write and never consults the lifecycle reader, even for a read_only relationship', async () => {
    process.env.FORCE_CAPABILITIES = 'co-managed:off';
    const reader = vi.fn(async () => ({ state: 'read_only' as const, canWrite: false, graceEndsAt: null }));
    const resolver = createCoManagedWriteAdmissionResolver(reader as any);
    expect(await resolver({} as any, 'tenant-1')).toEqual({ canWrite: true });
    expect(reader).not.toHaveBeenCalled();
    delete process.env.FORCE_CAPABILITIES;
    expect(await resolver({} as any, 'tenant-1')).toMatchObject({ canWrite: false });
    expect(reader).toHaveBeenCalledTimes(1);
  });
});

describe('participating tenant', () => {
  it('reaches the body (the harness is not vacuous)', async () => {
    registerCapabilityParticipation('co-managed', async ({ tenantIds }) => new Set(tenantIds));
    await (getCoManagedDeparture as any)({});
    expect(touched.departed).toHaveBeenCalledTimes(1);
  });
});
