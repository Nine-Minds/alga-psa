import { afterAll, afterEach, expect, it, vi } from 'vitest';
import { isCoManagedLifecycleError } from '@alga-psa/licensing/lifecycle-error';
import { createFakeKnex, CO_MANAGED_TENANT, clearWriteAdmissionCacheForTests, withReadOnlyWorkspace } from './fakeKnex';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));

const asset = { asset_id: 'a1', client_id: 'c1', asset_type: 'workstation', name: 'n', asset_tag: 't', status: 'active', created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
const fake = createFakeKnex((sql) => (/from "assets"/.test(sql) ? [asset] : undefined));
afterAll(() => fake.destroy());
afterEach(() => {
  fake.statements.length = 0;
  clearWriteAdmissionCacheForTests();
});

it('updateAssetRecord is refused on a read-only co-managed tenant and writes nothing', async () => {
  const { updateAssetRecord } = await import('@alga-psa/assets/actions/assetActions');
  await withReadOnlyWorkspace(async () => {
    const error: any = await updateAssetRecord(fake.knex, CO_MANAGED_TENANT, 'u1', 'a1', { name: 'renamed' } as any).catch((e) => e);
    expect(isCoManagedLifecycleError(error)).toBe(true);
    expect(error.code).toBe('CO_MANAGED_READ_ONLY');
    expect(fake.writes()).toEqual([]);
  });
});
