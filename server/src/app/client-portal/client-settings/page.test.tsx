import { beforeEach, describe, expect, it, vi } from 'vitest';

const permsMock = vi.hoisted(() => vi.fn());
const notFoundMock = vi.hoisted(() =>
  vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
);

vi.mock('next/navigation', () => ({ notFound: notFoundMock }));
vi.mock('@alga-psa/client-portal/actions', () => ({
  checkClientPortalPermissions: (...a: unknown[]) => permsMock(...a),
}));
vi.mock('@alga-psa/client-portal/components', () => ({
  ClientPortalSettingsPage: () => null,
}));
vi.mock('@alga-psa/ui/lib/i18n/serverOnly', () => ({
  getServerTranslation: async () => ({ t: (_k: string, o: any) => o?.defaultValue }),
}));

import ClientSettingsPage from './page';

const none = {
  hasBillingAccess: false,
  hasClientReadAccess: false,
  hasUserManagementAccess: false,
  hasVisibilityGroupAccess: false,
  isHosted: false,
};

describe('client-settings route guard', () => {
  beforeEach(() => {
    permsMock.mockReset();
    notFoundMock.mockClear();
  });

  it('calls notFound() when no settings tab is permitted', async () => {
    permsMock.mockResolvedValue(none);
    await expect(ClientSettingsPage()).rejects.toThrow('NEXT_NOT_FOUND');
    expect(notFoundMock).toHaveBeenCalled();
  });

  it('renders the settings page when a tab is permitted', async () => {
    permsMock.mockResolvedValue({ ...none, hasClientReadAccess: true });
    const el: any = await ClientSettingsPage();
    expect(notFoundMock).not.toHaveBeenCalled();
    expect(el).toBeTruthy();
  });
});
