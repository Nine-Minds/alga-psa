import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GET, OPTIONS, POST } from '../../../../../../ee/server/src/app/api/teams/package/route';

const { getTeamsAppPackageStatusMock } = vi.hoisted(() => ({
  getTeamsAppPackageStatusMock: vi.fn(),
}));

vi.mock('@alga-psa/integrations/actions', () => ({
  getTeamsAppPackageStatus: (...args: unknown[]) => getTeamsAppPackageStatusMock(...args),
}));

describe('GET/POST /api/teams/package', () => {
  beforeEach(() => {
    getTeamsAppPackageStatusMock.mockReset();
  });

  it('T149/T150: maps disabled Teams package handoff responses to a stable 404 result in EE', async () => {
    getTeamsAppPackageStatusMock.mockResolvedValue({
      success: false,
      error: 'Microsoft Teams integration is disabled for this tenant.',
    });

    const response = await GET();

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      success: false,
      error: 'Microsoft Teams integration is disabled for this tenant.',
    });
  });

  it('T151/T152: delegates package handoff requests to the shared Teams package action when Teams is enabled', async () => {
    getTeamsAppPackageStatusMock.mockResolvedValue({
      success: true,
      package: {
        installStatus: 'install_pending',
        selectedProfileId: 'profile-1',
        appId: 'app-1',
        botId: 'bot-1',
        manifestVersion: '1.24',
        packageVersion: '1.0.0',
        fileName: 'alga-psa-teams-tenant-1.zip',
        baseUrl: 'https://desk.example.com',
        validDomains: ['desk.example.com'],
        webApplicationInfo: {
          id: 'app-1',
          resource: 'api://desk.example.com/teams/app-1',
        },
        deepLinks: {
          myWork: 'https://desk.example.com/teams/tab',
          ticketTemplate: 'ticket',
          projectTaskTemplate: 'task',
          approvalTemplate: 'approval',
          timeEntryTemplate: 'time',
          contactTemplate: 'contact',
        },
        manifest: {
          manifestVersion: '1.24',
        },
      },
    });

    const getResponse = await GET();
    const postResponse = await POST();

    expect(getTeamsAppPackageStatusMock).toHaveBeenCalledTimes(2);
    expect(getResponse.status).toBe(200);
    expect(postResponse.status).toBe(200);
  });

  it('T153: exposes a stable OPTIONS response for Teams package/install routes', async () => {
    const response = await OPTIONS();

    expect(response.status).toBe(204);
    expect(response.headers.get('Allow')).toBe('GET, POST, OPTIONS');
  });
});
