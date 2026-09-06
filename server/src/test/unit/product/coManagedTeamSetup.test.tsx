/** @vitest-environment jsdom */
import React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import TeamSetupPage from '../../../app/auth/team/setup/page';
const mocks = vi.hoisted(() => ({ flag: vi.fn(), verify: vi.fn(), complete: vi.fn() }));
vi.mock('@alga-psa/ui/hooks', () => ({ useFeatureFlag: mocks.flag }));
vi.mock('@alga-psa/users/actions/user-actions/userInvitationActions', () => ({ verifyUserInvitationToken: mocks.verify, completeUserInvitationSetup: mocks.complete }));
vi.mock('../../../lib/actions/coManagedAcceptanceActions', () => ({}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }), useSearchParams: () => new URLSearchParams('token=test-token') }));
vi.mock('next-auth/react', () => ({ signIn: vi.fn() }));
vi.mock('@alga-psa/tenancy/components', () => ({ I18nWrapper: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
const translate = (key: string) => key;
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({ useTranslation: () => ({ t: translate }), useOptionalI18n: () => null }));
const verified = { success: true, isCoManaged: true, invitee: { email: 'admin@example.test', first_name: 'Customer', last_name: 'Admin', role_name: 'Admin' } };
beforeEach(() => { vi.resetAllMocks(); mocks.flag.mockReturnValue({ enabled: false, loading: false, error: null }); mocks.verify.mockResolvedValue(verified); });
afterEach(cleanup);
describe('co-managed invitation setup UI', () => {
  it('hides the co-managed password form after identifying the verified invitation product when the flag is off', async () => {
    render(<TeamSetupPage />);
    await waitFor(() => expect(mocks.flag).toHaveBeenCalled());
    expect(screen.queryByText('teamSetup.title')).toBeNull(); expect(mocks.complete).not.toHaveBeenCalled();
    expect(mocks.verify).toHaveBeenCalledWith('test-token');
  });
  it('keeps ordinary team invitations independent of the co-managed release flag', async () => {
    mocks.verify.mockResolvedValue({ ...verified, isCoManaged: false }); render(<TeamSetupPage />);
    await screen.findByText('teamSetup.title'); expect(mocks.flag).not.toHaveBeenCalled();
  });
  it('shows the co-managed setup form with the flag enabled', async () => {
    mocks.flag.mockReturnValue({ enabled: true, loading: false, error: null }); render(<TeamSetupPage />);
    await screen.findByText('teamSetup.title'); expect(mocks.complete).not.toHaveBeenCalled();
  });
});
