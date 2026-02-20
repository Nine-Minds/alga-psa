import { beforeEach, describe, expect, it, vi } from 'vitest';

const requireEntraUiFlagEnabledMock = vi.fn();
const getEntraSyncRunProgressMock = vi.fn();
const serializeEntraSyncRunProgressMock = vi.fn();

vi.mock('@ee/app/api/integrations/entra/_guards', () => ({
  requireEntraUiFlagEnabled: requireEntraUiFlagEnabledMock,
}));

vi.mock('@ee/lib/integrations/entra/entraWorkflowClient', () => ({
  getEntraSyncRunProgress: getEntraSyncRunProgressMock,
}));

vi.mock('@ee/lib/integrations/entra/sync/syncResultSerializer', () => ({
  serializeEntraSyncRunProgress: serializeEntraSyncRunProgressMock,
}));

describe('Entra sync run progress route', () => {
  beforeEach(() => {
    vi.resetModules();
    requireEntraUiFlagEnabledMock.mockReset();
    getEntraSyncRunProgressMock.mockReset();
    serializeEntraSyncRunProgressMock.mockReset();
  });

  it('T082: returns run-level and tenant-level status payload for polling', async () => {
    requireEntraUiFlagEnabledMock.mockResolvedValue({
      tenantId: 'tenant-82',
      userId: 'user-82',
    });
    getEntraSyncRunProgressMock.mockResolvedValue({
      run: {
        runId: 'run-82',
        status: 'partial',
        runType: 'all-tenants',
        startedAt: '2026-02-20T00:00:00.000Z',
        completedAt: null,
        totalTenants: 3,
        processedTenants: 2,
        succeededTenants: 1,
        failedTenants: 1,
        summary: { linked: 12 },
      },
      tenantResults: [
        {
          managedTenantId: 'managed-82a',
          clientId: 'client-82a',
          status: 'completed',
          created: 0,
          linked: 7,
          updated: 0,
          ambiguous: 0,
          inactivated: 0,
          errorMessage: null,
          startedAt: '2026-02-20T00:00:00.000Z',
          completedAt: '2026-02-20T00:01:00.000Z',
        },
      ],
    });
    serializeEntraSyncRunProgressMock.mockImplementation((value: unknown) => value);

    const { GET } = await import('@ee/app/api/integrations/entra/sync/runs/[runId]/route');
    const response = await GET(new Request('https://localhost'), {
      params: Promise.resolve({ runId: 'run-82' }),
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(payload.data).toMatchObject({
      run: expect.objectContaining({
        runId: 'run-82',
        status: 'partial',
      }),
      tenantResults: [
        expect.objectContaining({
          managedTenantId: 'managed-82a',
          status: 'completed',
        }),
      ],
    });

    expect(getEntraSyncRunProgressMock).toHaveBeenCalledWith('tenant-82', 'run-82');
    expect(serializeEntraSyncRunProgressMock).toHaveBeenCalledWith(
      expect.objectContaining({
        run: expect.any(Object),
        tenantResults: expect.any(Array),
      })
    );
  });
});
