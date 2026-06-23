import { describe, expect, it, vi, beforeEach } from 'vitest';

const { hasPermissionMock } = vi.hoisted(() => ({
  hasPermissionMock: vi.fn(async () => true),
}));

vi.mock('@alga-psa/auth', () => ({
  hasPermission: (...args: unknown[]) => hasPermissionMock(...args),
  withAuth: (action: (...args: unknown[]) => Promise<unknown>) => (input: unknown) => action({
    user_id: 'user-1',
    username: 'user',
    email: 'user@example.com',
    is_inactive: false,
    tenant: 'tenant-1',
    user_type: 'internal',
    roles: [{ role_id: 'role-1', role_name: 'admin', msp: true, client: false }],
  }, { tenant: 'tenant-1' }, input),
}));

vi.mock('@alga-psa/tenancy/actions', () => ({
  getHierarchicalLocaleAction: vi.fn(async () => 'fr'),
}));

vi.mock('../core/ReportEngine', () => ({
  ReportEngine: {
    execute: vi.fn(async () => ({ reportId: 'r', metrics: {} })),
  },
}));

vi.mock('../core/ReportRegistry', () => ({
  ReportRegistry: {
    get: vi.fn(() => ({
      id: 'r',
      name: 'R',
      version: '1',
      category: 'billing',
      metrics: [],
      permissions: {
        roles: ['admin'],
        resources: ['billing.read'],
      },
    })),
  },
}));

import { executeReport } from './executeReport';
import { ReportEngine } from '../core/ReportEngine';

const executeMock = ReportEngine.execute as ReturnType<typeof vi.fn>;

describe('executeReport locale resolution', () => {
  beforeEach(() => {
    hasPermissionMock.mockResolvedValue(true);
    executeMock.mockClear();
  });

  it('passes the hierarchically-resolved locale when none is provided', async () => {
    await executeReport({ reportId: 'r' });
    const options = executeMock.mock.calls.at(-1)![2];
    expect(options.locale).toBe('fr');
  });

  it('lets an explicitly passed locale win', async () => {
    await executeReport({ reportId: 'r', options: { locale: 'de' } });
    const options = executeMock.mock.calls.at(-1)![2];
    expect(options.locale).toBe('de');
  });

  it('requires the report definition resource permission before execution', async () => {
    hasPermissionMock.mockResolvedValue(false);

    await expect(executeReport({ reportId: 'r' })).rejects.toThrow('Access denied for report: r');
    expect(executeMock).not.toHaveBeenCalled();
  });
});
