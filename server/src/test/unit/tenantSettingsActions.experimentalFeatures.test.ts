import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

let mockTenantContext: string | null = null;
let allowTenantKnex = false;
let tenantSettingsRow: any = null;
const originalMasterBillingTenantId = process.env.MASTER_BILLING_TENANT_ID;

const knexWhereMock = vi.fn();
const knexFromMock = vi.fn();
const knexSelectMock = vi.fn();
const createTenantKnexMock = vi.fn();

const getCurrentUserMock = vi.fn();
const getCurrentUserPermissionsMock = vi.fn();

const tenantKnexTableMock = vi.fn();
const knexInsertMock = vi.fn();
const knexOnConflictMock = vi.fn();
const knexMergeMock = vi.fn();

vi.mock('next/headers.js', () => ({
  headers: async () => new Headers(),
}));

vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: any) => async (...args: any[]) =>
    fn({ user_id: 'user-test', tenant: 'tenant-test', roles: [] }, { tenant: 'tenant-test' }, ...args),
  withOptionalAuth: (fn: any) => async (...args: any[]) =>
    fn({ user_id: 'user-test', tenant: 'tenant-test', roles: [] }, { tenant: 'tenant-test' }, ...args),
}));

vi.mock('@alga-psa/db', () => ({
  getTenantContext: () => mockTenantContext,
  createTenantKnex: createTenantKnexMock,
}));

vi.mock('@alga-psa/users/actions', () => ({
  getCurrentUser: getCurrentUserMock,
  getCurrentUserPermissions: getCurrentUserPermissionsMock,
}));

describe('tenantSettingsActions.getExperimentalFeatures', () => {
  beforeEach(() => {
    process.env.MASTER_BILLING_TENANT_ID = 'tenant-test';
    mockTenantContext = null;
    allowTenantKnex = true;
    tenantSettingsRow = null;

    getCurrentUserMock.mockReset();
    getCurrentUserPermissionsMock.mockReset();

    tenantKnexTableMock.mockReset();
    knexInsertMock.mockReset();
    knexOnConflictMock.mockReset();
    knexMergeMock.mockReset();

    knexWhereMock.mockReset();
    knexFromMock.mockReset();
    knexSelectMock.mockReset();
    createTenantKnexMock.mockReset();

    knexWhereMock.mockImplementation(() => ({
      first: vi.fn(async () => tenantSettingsRow),
    }));

    knexFromMock.mockImplementation(() => ({
      where: knexWhereMock,
    }));

    knexSelectMock.mockImplementation(() => ({
      from: knexFromMock,
    }));

    createTenantKnexMock.mockImplementation(async () => {
      if (!allowTenantKnex) {
        throw new Error(
          'createTenantKnex should not be called when tenant is unresolved'
        );
      }

      return {
        knex: {
          select: knexSelectMock,
        },
      };
    });
  });

  it('returns defaults when tenant settings are unavailable', async () => {
    const { getExperimentalFeatures } = await import(
      '../../../../packages/tenancy/src/actions/tenant-settings-actions/tenantSettingsActions'
    );

    await expect(getExperimentalFeatures()).resolves.toEqual({ aiAssistant: false, workflowAutomation: false });
    expect(createTenantKnexMock).toHaveBeenCalled();
  });

  it('returns saved experimental features from tenant_settings', async () => {
    allowTenantKnex = true;
    tenantSettingsRow = {
      settings: {
        experimentalFeatures: {
          aiAssistant: true,
          workflowAutomation: true,
        },
      },
    };

    const { getExperimentalFeatures } = await import(
      '../../../../packages/tenancy/src/actions/tenant-settings-actions/tenantSettingsActions'
    );

    await expect(getExperimentalFeatures()).resolves.toEqual({ aiAssistant: true, workflowAutomation: true });
    expect(knexWhereMock).toHaveBeenCalledWith({ tenant: 'tenant-test' });
  });

  it('forces aiAssistant off when tenant is not the master billing tenant', async () => {
    process.env.MASTER_BILLING_TENANT_ID = 'some-other-tenant';
    tenantSettingsRow = {
      settings: {
        experimentalFeatures: {
          aiAssistant: true,
          workflowAutomation: true,
        },
      },
    };

    const { getExperimentalFeatures } = await import(
      '../../../../packages/tenancy/src/actions/tenant-settings-actions/tenantSettingsActions'
    );

    await expect(getExperimentalFeatures()).resolves.toEqual({ aiAssistant: false, workflowAutomation: true });
  });
});

describe('tenantSettingsActions.updateExperimentalFeatures', () => {
  beforeEach(() => {
    process.env.MASTER_BILLING_TENANT_ID = 'tenant-test';
    allowTenantKnex = true;
    tenantSettingsRow = null;

    getCurrentUserMock.mockReset();
    getCurrentUserPermissionsMock.mockReset();

    tenantKnexTableMock.mockReset();
    knexInsertMock.mockReset();
    knexOnConflictMock.mockReset();
    knexMergeMock.mockReset();

    knexWhereMock.mockReset();
    knexFromMock.mockReset();
    knexSelectMock.mockReset();
    createTenantKnexMock.mockReset();

    getCurrentUserMock.mockResolvedValue({
      id: 'user-test',
      tenant: 'tenant-test',
      roles: [],
    } as any);
    getCurrentUserPermissionsMock.mockResolvedValue(['settings:update']);

    knexWhereMock.mockImplementation(() => ({
      first: vi.fn(async () => tenantSettingsRow),
    }));

    knexFromMock.mockImplementation(() => ({
      where: knexWhereMock,
    }));

    knexSelectMock.mockImplementation(() => ({
      from: knexFromMock,
    }));

    knexMergeMock.mockResolvedValue(undefined);
    knexOnConflictMock.mockImplementation(() => ({
      merge: knexMergeMock,
    }));

    knexInsertMock.mockImplementation(() => ({
      onConflict: knexOnConflictMock,
    }));

    tenantKnexTableMock.mockImplementation(() => ({
      insert: knexInsertMock,
    }));

    const tenantKnex = Object.assign(tenantKnexTableMock, {
      select: knexSelectMock,
    });

    createTenantKnexMock.mockImplementation(async () => {
      if (!allowTenantKnex) {
        throw new Error('createTenantKnex should not be called');
      }

      return {
        knex: tenantKnex,
      };
    });
  });

  it('creates settings entry when none exists', async () => {
    const { updateExperimentalFeatures } = await import(
      '../../../../packages/tenancy/src/actions/tenant-settings-actions/tenantSettingsActions'
    );

    await expect(
      updateExperimentalFeatures({ aiAssistant: true })
    ).resolves.toBeUndefined();

    expect(tenantKnexTableMock).toHaveBeenCalledWith('tenant_settings');
    expect(knexInsertMock).toHaveBeenCalledTimes(1);

    const [insertArg] = knexInsertMock.mock.calls[0] ?? [];
    expect(insertArg).toEqual(
      expect.objectContaining({
        tenant: 'tenant-test',
      })
    );

    const parsedSettings = JSON.parse(insertArg.settings);
    expect(parsedSettings).toEqual({
      experimentalFeatures: {
        aiAssistant: true,
        workflowAutomation: false,
      },
    });

    expect(knexOnConflictMock).toHaveBeenCalledWith('tenant');
    expect(knexMergeMock).toHaveBeenCalledTimes(1);
  });

  it('merges with existing settings without overwriting other keys', async () => {
    tenantSettingsRow = {
      settings: {
        analytics: {
          enabled: true,
          sampleRate: 0.5,
        },
        experimentalFeatures: {
          aiAssistant: false,
        },
      },
    };

    const { updateExperimentalFeatures } = await import(
      '../../../../packages/tenancy/src/actions/tenant-settings-actions/tenantSettingsActions'
    );

    await expect(
      updateExperimentalFeatures({ aiAssistant: true })
    ).resolves.toBeUndefined();

    expect(knexInsertMock).toHaveBeenCalledTimes(1);
    const [insertArg] = knexInsertMock.mock.calls[0] ?? [];
    const parsedSettings = JSON.parse(insertArg.settings);

    expect(parsedSettings).toEqual({
      analytics: {
        enabled: true,
        sampleRate: 0.5,
      },
      experimentalFeatures: {
        aiAssistant: true,
        workflowAutomation: false,
      },
    });
  });

  it('requires settings:update permission', async () => {
    allowTenantKnex = false;
    getCurrentUserPermissionsMock.mockResolvedValue([]);
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { updateExperimentalFeatures } = await import(
      '../../../../packages/tenancy/src/actions/tenant-settings-actions/tenantSettingsActions'
    );

    try {
      await expect(updateExperimentalFeatures({ aiAssistant: true })).rejects.toThrow(
        'Permission denied: Cannot update settings'
      );
    } finally {
      consoleErrorSpy.mockRestore();
    }

    expect(createTenantKnexMock).not.toHaveBeenCalled();
    expect(tenantKnexTableMock).not.toHaveBeenCalled();
  });

  it('rejects enabling aiAssistant when tenant is not the master billing tenant', async () => {
    process.env.MASTER_BILLING_TENANT_ID = 'some-other-tenant';
    allowTenantKnex = false;
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { updateExperimentalFeatures } = await import(
      '../../../../packages/tenancy/src/actions/tenant-settings-actions/tenantSettingsActions'
    );

    try {
      await expect(updateExperimentalFeatures({ aiAssistant: true })).rejects.toThrow(
        'Permission denied: Cannot enable AI Assistant for this tenant'
      );
    } finally {
      consoleErrorSpy.mockRestore();
    }

    expect(createTenantKnexMock).not.toHaveBeenCalled();
    expect(tenantKnexTableMock).not.toHaveBeenCalled();
  });
});

describe('tenantSettingsActions.isExperimentalFeatureEnabled', () => {
  beforeEach(() => {
    process.env.MASTER_BILLING_TENANT_ID = 'tenant-test';
    allowTenantKnex = true;
    tenantSettingsRow = null;

    getCurrentUserMock.mockReset();
    getCurrentUserPermissionsMock.mockReset();

    tenantKnexTableMock.mockReset();
    knexInsertMock.mockReset();
    knexOnConflictMock.mockReset();
    knexMergeMock.mockReset();

    knexWhereMock.mockReset();
    knexFromMock.mockReset();
    knexSelectMock.mockReset();
    createTenantKnexMock.mockReset();

    knexWhereMock.mockImplementation(() => ({
      first: vi.fn(async () => tenantSettingsRow),
    }));

    knexFromMock.mockImplementation(() => ({
      where: knexWhereMock,
    }));

    knexSelectMock.mockImplementation(() => ({
      from: knexFromMock,
    }));

    createTenantKnexMock.mockImplementation(async () => {
      if (!allowTenantKnex) {
        throw new Error('createTenantKnex should not be called');
      }

      return {
        knex: {
          select: knexSelectMock,
        },
      };
    });
  });

  it('returns false for unknown feature keys', async () => {
    tenantSettingsRow = {
      settings: {
        experimentalFeatures: {
          aiAssistant: true,
        },
      },
    };

    const { isExperimentalFeatureEnabled } = await import(
      '../../../../packages/tenancy/src/actions/tenant-settings-actions/tenantSettingsActions'
    );

    await expect(isExperimentalFeatureEnabled('notAFeature')).resolves.toBe(false);
    expect(knexWhereMock).toHaveBeenCalledWith({ tenant: 'tenant-test' });
  });

  it("returns false for aiAssistant when it's not set", async () => {
    tenantSettingsRow = {
      settings: {},
    };

    const { isExperimentalFeatureEnabled } = await import(
      '../../../../packages/tenancy/src/actions/tenant-settings-actions/tenantSettingsActions'
    );

    await expect(isExperimentalFeatureEnabled('aiAssistant')).resolves.toBe(false);
    expect(knexWhereMock).toHaveBeenCalledWith({ tenant: 'tenant-test' });
  });

  it('returns true for aiAssistant when enabled', async () => {
    tenantSettingsRow = {
      settings: {
        experimentalFeatures: {
          aiAssistant: true,
        },
      },
    };

    const { isExperimentalFeatureEnabled } = await import(
      '../../../../packages/tenancy/src/actions/tenant-settings-actions/tenantSettingsActions'
    );

    await expect(isExperimentalFeatureEnabled('aiAssistant')).resolves.toBe(true);
    expect(knexWhereMock).toHaveBeenCalledWith({ tenant: 'tenant-test' });
  });
});

afterAll(() => {
  process.env.MASTER_BILLING_TENANT_ID = originalMasterBillingTenantId;
});
