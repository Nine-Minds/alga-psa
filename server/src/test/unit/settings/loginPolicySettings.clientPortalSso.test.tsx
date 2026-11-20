// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@alga-psa/ui/lib/i18n/client', async () => {
  const { createInstance } = await import('i18next');
  const en = (await import('../../../../public/locales/en/msp/settings.json')).default;
  const i18n = createInstance();
  await i18n.init({ resources: { en: { settings: en } }, lng: 'en', fallbackLng: 'en' });
  const t = i18n.getFixedT('en', 'settings');
  return { useTranslation: () => ({ t }) };
});

const actions = vi.hoisted(() => ({ get: vi.fn(), update: vi.fn() }));
vi.mock('@ee/lib/actions/auth/loginPolicy', () => ({
  getLoginPolicyAction: actions.get,
  updateLoginPolicyAction: actions.update,
}));

import LoginPolicySettings from '../../../../../ee/server/src/components/settings/security/LoginPolicySettings';

const basePolicy = {
  requireSsoForInternalUsers: false,
  require2faForInternalUsers: false,
  require2faForClientUsers: false,
  allowKnownDevice2faSkip: false,
  passwordBreakGlassUserIds: [] as string[],
  passwordAuthDisabledAt: null,
  clientPortalSsoProviders: null as string[] | null,
};

const makeState = (over: Record<string, unknown> = {}) => ({
  policy: basePolicy,
  eligibleBreakGlassAdmins: [],
  ineligibleBreakGlassUsers: [],
  hasConfiguredSsoProvider: true,
  availableClientPortalSsoProviders: ['google', 'azure-ad'],
  ...over,
});

const box = (id: string) => document.getElementById(`login-policy-client-portal-sso-${id}`) as HTMLInputElement | null;

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('LoginPolicySettings client portal SSO options', () => {
  it('checks every available provider when no list is saved, labelled from translations', async () => {
    actions.get.mockResolvedValue(makeState());
    render(<LoginPolicySettings />);

    await waitFor(() => expect(box('google')).not.toBeNull());
    expect(box('google')!.checked).toBe(true);
    expect(box('azure-ad')!.checked).toBe(true);
    expect(box('keycloak')).toBeNull();
    const group = document.getElementById('login-policy-client-portal-sso')!;
    expect(group.textContent).toContain('Client portal sign-in options');
    expect(group.textContent).toContain('Microsoft');
    expect(document.getElementById('login-policy-client-portal-sso-none')).toBeNull();
  });

  it('reflects a saved list', async () => {
    actions.get.mockResolvedValue(
      makeState({ policy: { ...basePolicy, clientPortalSsoProviders: ['azure-ad'] } }),
    );
    render(<LoginPolicySettings />);

    await waitFor(() => expect(box('google')).not.toBeNull());
    expect(box('google')!.checked).toBe(false);
    expect(box('azure-ad')!.checked).toBe(true);
  });

  it('saves the full resulting list when a box is unchecked and shows the persisted result', async () => {
    actions.get.mockResolvedValue(makeState());
    actions.update.mockResolvedValue({
      success: true,
      state: makeState({ policy: { ...basePolicy, clientPortalSsoProviders: ['azure-ad'] } }),
    });
    render(<LoginPolicySettings />);
    await waitFor(() => expect(box('google')).not.toBeNull());

    fireEvent.click(box('google')!);

    await waitFor(() => expect(actions.update).toHaveBeenCalledTimes(1));
    expect(actions.update).toHaveBeenCalledWith({ clientPortalSsoProviders: ['azure-ad'] });
    await waitFor(() => expect(box('google')!.checked).toBe(false));
  });

  it('re-checking a box from a saved list saves the grown list in canonical order', async () => {
    actions.get.mockResolvedValue(
      makeState({ policy: { ...basePolicy, clientPortalSsoProviders: ['azure-ad'] } }),
    );
    actions.update.mockResolvedValue({ success: true, state: makeState() });
    render(<LoginPolicySettings />);
    await waitFor(() => expect(box('google')).not.toBeNull());

    fireEvent.click(box('google')!);

    await waitFor(() => expect(actions.update).toHaveBeenCalledWith({ clientPortalSsoProviders: ['google', 'azure-ad'] }));
  });

  it('reverts the checkbox and shows the save error when the save fails', async () => {
    actions.get.mockResolvedValue(makeState());
    actions.update.mockResolvedValue({ success: false, errors: ['save_failed'] });
    render(<LoginPolicySettings />);
    await waitFor(() => expect(box('google')).not.toBeNull());

    fireEvent.click(box('google')!);

    await waitFor(() => expect(document.getElementById('login-policy-save-error')).not.toBeNull());
    expect(box('google')!.checked).toBe(true);
  });

  it('shows the guard message when the server rejects the list', async () => {
    actions.get.mockResolvedValue(makeState());
    actions.update.mockResolvedValue({ success: false, errors: ['client_portal_sso_provider_invalid'] });
    render(<LoginPolicySettings />);
    await waitFor(() => expect(box('google')).not.toBeNull());

    fireEvent.click(box('azure-ad')!);

    await waitFor(() => expect(document.getElementById('login-policy-guard-errors')).not.toBeNull());
    expect(document.getElementById('login-policy-guard-errors')!.textContent).toContain(
      'Choose only supported single sign-on providers.',
    );
    expect(box('azure-ad')!.checked).toBe(true);
  });

  it('shows the none-available note instead of checkboxes when no provider can sign in', async () => {
    actions.get.mockResolvedValue(makeState({ availableClientPortalSsoProviders: [] }));
    render(<LoginPolicySettings />);

    await waitFor(() => expect(document.getElementById('login-policy-client-portal-sso-none')).not.toBeNull());
    expect(document.getElementById('login-policy-client-portal-sso-none')!.textContent).toContain(
      'No single sign-on providers are configured',
    );
    expect(box('google')).toBeNull();
  });
});
