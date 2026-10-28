/** @vitest-environment jsdom */
import React from 'react';
import fs from 'node:fs';
import path from 'node:path';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import TeamSetupPage from '../../../app/auth/team/setup/page';
import PortalSetupPage from '../../../app/auth/portal/setup/page';

// The invitation pages used to send `username` to the credentials provider.
// The provider reads `email`/`userType`/`tenant`, so authorize() returned null
// for every invitee: they were bounced to a sign-in page, and a browser
// already signed in as someone else kept that session.

const mocks = vi.hoisted(() => ({
  verifyTeam: vi.fn(),
  completeTeam: vi.fn(),
  verifyPortal: vi.fn(),
  completePortal: vi.fn(),
  signIn: vi.fn(),
  push: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  search: { current: 'token=test-token' },
}));

vi.mock('@alga-psa/users/actions/user-actions/userInvitationActions', () => ({
  verifyUserInvitationToken: mocks.verifyTeam,
  completeUserInvitationSetup: mocks.completeTeam,
}));
vi.mock('@alga-psa/client-portal/actions', () => ({
  verifyPortalToken: mocks.verifyPortal,
  completePortalSetup: mocks.completePortal,
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mocks.push }),
  useSearchParams: () => new URLSearchParams(mocks.search.current),
}));
vi.mock('next-auth/react', () => ({ signIn: mocks.signIn }));
vi.mock('react-hot-toast', () => ({
  default: { success: mocks.toastSuccess, error: mocks.toastError },
}));
vi.mock('@alga-psa/tenancy/components', () => ({
  I18nWrapper: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  useOptionalI18n: () => null,
}));

const PASSWORD = 'NineMinds1234!';

async function submitSetupForm(createButtonId: string) {
  await waitFor(() => expect(document.getElementById('password')).not.toBeNull());
  for (const id of ['password', 'confirmPassword']) {
    fireEvent.change(document.getElementById(id)!, { target: { name: id, value: PASSWORD } });
  }
  fireEvent.submit(document.getElementById(createButtonId)!.closest('form')!);
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.search.current = 'token=test-token';
  mocks.verifyTeam.mockResolvedValue({
    success: true,
    invitee: { email: 'invitee@example.test', first_name: 'Ina', last_name: 'Vitee', role_name: 'Admin' },
  });
  mocks.completeTeam.mockResolvedValue({ success: true, username: 'invitee@example.test' });
  mocks.verifyPortal.mockResolvedValue({
    success: true,
    contact: {
      contact_name_id: 'c-1',
      full_name: 'Pat Portal',
      email: 'pat@example.test',
      client_name: 'Acme',
    },
  });
  mocks.completePortal.mockResolvedValue({ success: true, username: 'pat@example.test' });
  mocks.signIn.mockResolvedValue({ ok: true, error: undefined, url: '/' });
});
afterEach(cleanup);

describe('team invitation auto sign-in', () => {
  it('signs in with the fields the credentials provider reads and lands on the MSP dashboard', async () => {
    render(<TeamSetupPage />);
    await submitSetupForm('create-team-account-button');

    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith('/msp/dashboard'));
    expect(mocks.completeTeam).toHaveBeenCalledWith('test-token', PASSWORD);
    expect(mocks.signIn).toHaveBeenCalledTimes(1);
    expect(mocks.signIn).toHaveBeenCalledWith('credentials', {
      email: 'invitee@example.test',
      password: PASSWORD,
      userType: 'internal',
      redirect: false,
    });
  });

  it('falls back to the sign-in page with the account-ready toast when auto sign-in fails', async () => {
    mocks.signIn.mockResolvedValue({ error: 'CredentialsSignin', code: 'credentials' });
    render(<TeamSetupPage />);
    await submitSetupForm('create-team-account-button');

    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith('/auth/msp/signin'));
    expect(mocks.toastSuccess).toHaveBeenCalledWith('teamSetup.accountReady');
    expect(mocks.push).not.toHaveBeenCalledWith('/msp/dashboard');
  });

  it('falls back to the sign-in page when signIn throws', async () => {
    mocks.signIn.mockRejectedValue(new Error('network'));
    render(<TeamSetupPage />);
    await submitSetupForm('create-team-account-button');

    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith('/auth/msp/signin'));
    expect(mocks.toastSuccess).toHaveBeenCalledWith('teamSetup.accountReady');
  });
});

describe('client portal invitation auto sign-in', () => {
  it('signs in as a client with the tenant slug and lands on the client portal dashboard', async () => {
    mocks.search.current = 'token=test-token&tenant=acme-msp';
    render(<PortalSetupPage />);
    await submitSetupForm('create-portal-account-button');

    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith('/client-portal/dashboard'));
    expect(mocks.signIn).toHaveBeenCalledTimes(1);
    expect(mocks.signIn).toHaveBeenCalledWith('credentials', {
      email: 'pat@example.test',
      password: PASSWORD,
      userType: 'client',
      tenant: 'acme-msp',
      redirect: false,
    });
  });

  it('omits the tenant field when the link carries no tenant slug', async () => {
    render(<PortalSetupPage />);
    await submitSetupForm('create-portal-account-button');

    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith('/client-portal/dashboard'));
    const payload = mocks.signIn.mock.calls[0][1] as Record<string, unknown>;
    expect(payload).toEqual({
      email: 'pat@example.test',
      password: PASSWORD,
      userType: 'client',
      redirect: false,
    });
    expect('tenant' in payload).toBe(false);
  });

  it('falls back to the tenant-scoped client sign-in page when auto sign-in fails', async () => {
    mocks.search.current = 'token=test-token&tenant=acme-msp';
    mocks.signIn.mockResolvedValue({ error: 'CredentialsSignin' });
    render(<PortalSetupPage />);
    await submitSetupForm('create-portal-account-button');

    await waitFor(() => expect(mocks.push).toHaveBeenCalledTimes(1));
    expect(mocks.push.mock.calls[0][0]).toMatch(/^\/auth\/client-portal\/signin\?tenant=acme-msp&message=/);
    expect(mocks.toastSuccess).toHaveBeenCalledWith('auth.portalSetup.accountReady');
  });
});

describe('auth pages never sign in with a username', () => {
  function listSources(dir: string): string[] {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return listSources(full);
      return /\.(ts|tsx)$/.test(entry.name) ? [full] : [];
    });
  }

  it('has no signIn(...) call under server/src/app/auth that passes a username key', () => {
    const authDir = path.resolve(__dirname, '../../../app/auth');
    const calls: string[] = [];
    for (const file of listSources(authDir)) {
      const source = fs.readFileSync(file, 'utf8');
      for (const match of source.matchAll(/signIn\s*\(\s*['"][\w-]+['"]\s*,\s*\{[^}]*\}/g)) {
        calls.push(match[0]);
      }
    }
    expect(calls.length).toBeGreaterThanOrEqual(2);
    for (const call of calls) {
      expect(call).not.toMatch(/\busername\s*:/);
    }
  });
});
