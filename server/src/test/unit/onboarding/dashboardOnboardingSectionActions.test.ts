import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ where: vi.fn(), insert: vi.fn(), first: vi.fn(), delete: vi.fn(), merge: vi.fn(), onConflict: vi.fn() }));

vi.mock('@alga-psa/auth', () => ({
  withAuth: (handler: (...args: any[]) => any) => (...args: any[]) => handler({ user_id: 'user-123' }, { tenant: 'tenant-1' }, ...args),
}));
vi.mock('@alga-psa/db', () => ({
  createTenantKnex: async () => ({ knex: {} }),
  tenantDb: () => ({ table: () => ({ where: mocks.where, insert: mocks.insert }) }),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import {
  dismissDashboardOnboardingSectionAction,
  getDashboardOnboardingSectionDismissedAction,
  restoreDashboardOnboardingSectionAction,
} from '../../../../../packages/onboarding/src/actions/onboarding-actions/dashboardOnboardingSectionActions';

describe('dashboard onboarding section preference actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.where.mockReturnValue({ first: mocks.first, delete: mocks.delete });
    mocks.first.mockResolvedValue(undefined);
    mocks.insert.mockReturnValue({ onConflict: mocks.onConflict.mockReturnValue({ merge: mocks.merge }) });
    mocks.merge.mockResolvedValue(undefined);
    mocks.delete.mockResolvedValue(undefined);
  });

  it('reads the preference for the authenticated user only', async () => {
    await getDashboardOnboardingSectionDismissedAction();
    expect(mocks.where).toHaveBeenCalledWith({ user_id: 'user-123', setting_name: 'dashboardOnboardingSectionDismissed' });
  });

  it('writes and deletes the preference for the authenticated user only', async () => {
    await dismissDashboardOnboardingSectionAction();
    const inserted = mocks.insert.mock.calls[0][0];
    expect(inserted).toMatchObject({ tenant: 'tenant-1', user_id: 'user-123', setting_name: 'dashboardOnboardingSectionDismissed' });
    expect(inserted.setting_value).toBe('true');
    expect(mocks.onConflict).toHaveBeenCalledWith(['tenant', 'user_id', 'setting_name']);
    expect(mocks.merge).toHaveBeenCalledWith(expect.objectContaining({ setting_value: 'true' }));

    await restoreDashboardOnboardingSectionAction();
    expect(mocks.where).toHaveBeenCalledWith({ user_id: 'user-123', setting_name: 'dashboardOnboardingSectionDismissed' });
  });

  it('reads native JSON booleans and string booleans without stripping quotes', async () => {
    mocks.first.mockResolvedValueOnce({ setting_value: true });
    expect(await getDashboardOnboardingSectionDismissedAction()).toMatchObject({ data: { dismissed: true } });
    mocks.first.mockResolvedValueOnce({ setting_value: 'true' });
    expect(await getDashboardOnboardingSectionDismissedAction()).toMatchObject({ data: { dismissed: true } });
  });
});
