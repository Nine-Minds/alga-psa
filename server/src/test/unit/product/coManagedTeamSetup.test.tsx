/** @vitest-environment jsdom */
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import TeamSetupPage from '../../../app/auth/team/setup/page';
const mocks = vi.hoisted(() => ({ flag: vi.fn(), verify: vi.fn(), complete: vi.fn(), signIn: vi.fn(), push: vi.fn() }));
vi.mock('@alga-psa/ui/hooks', () => ({ useFeatureFlag: mocks.flag }));
vi.mock('@alga-psa/users/actions/user-actions/userInvitationActions', () => ({ verifyUserInvitationToken: mocks.verify, completeUserInvitationSetup: mocks.complete }));
vi.mock('../../../lib/actions/coManagedAcceptanceActions', () => ({}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push }), useSearchParams: () => new URLSearchParams('token=test-token') }));
// The setup page renders inside AppSessionProvider (added so the pre-login
// co-managed invitation flow can call useSession), so the mock must supply the
// provider and session hook the real module exports.
vi.mock('next-auth/react', () => ({
  signIn: mocks.signIn,
  SessionProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useSession: () => ({ data: null, status: 'unauthenticated', update: vi.fn() }),
}));
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
  it('signs the new user in with the fields the credentials provider reads', async () => {
    // The page used to send `username`; the provider reads `email`, so every
    // auto sign-in failed and a browser already signed in as someone else kept
    // that session after the invitee created their account.
    mocks.verify.mockResolvedValue({ ...verified, isCoManaged: false });
    mocks.complete.mockResolvedValue({ success: true, username: 'admin@example.test' });
    mocks.signIn.mockResolvedValue({ ok: true, error: undefined, url: '/msp/dashboard' });
    render(<TeamSetupPage />);
    await screen.findByText('teamSetup.title');
    for (const id of ['password', 'confirmPassword']) {
      fireEvent.change(document.getElementById(id)!, { target: { name: id, value: 'NineMinds1234!' } });
    }
    fireEvent.submit(document.getElementById('create-team-account-button')!.closest('form')!);
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith('/msp/dashboard'));
    expect(mocks.complete).toHaveBeenCalledWith('test-token', 'NineMinds1234!');
    expect(mocks.signIn).toHaveBeenCalledWith('credentials', {
      email: 'admin@example.test', password: 'NineMinds1234!', userType: 'internal', redirect: false,
    });
  });
});
