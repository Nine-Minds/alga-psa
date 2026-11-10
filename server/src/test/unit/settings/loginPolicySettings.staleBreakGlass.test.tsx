// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@alga-psa/ui/lib/i18n/client', async () => {
  const { createInstance } = await import('i18next');
  const en = (await import('../../../../public/locales/en/msp/settings.json')).default;
  const i18n = createInstance();
  await i18n.init({ resources: { en: { settings: en } }, lng: 'en', fallbackLng: 'en' });
  // Stable `t`, like the real hook: the component's load effect depends on it.
  const t = i18n.getFixedT('en', 'settings');
  return { useTranslation: () => ({ t }) };
});

const actions = vi.hoisted(() => ({ get: vi.fn(), update: vi.fn() }));
vi.mock('@ee/lib/actions/auth/loginPolicy', () => ({
  getLoginPolicyAction: actions.get,
  updateLoginPolicyAction: actions.update,
}));

import LoginPolicySettings from '../../../../../ee/server/src/components/settings/security/LoginPolicySettings';

const policy = {
  requireSsoForInternalUsers: true,
  require2faForInternalUsers: false,
  require2faForClientUsers: false,
  allowKnownDevice2faSkip: false,
  passwordBreakGlassUserIds: ['stale-1', 'ghost-2', 'ok-3'],
  passwordAuthDisabledAt: '2026-01-01T00:00:00.000Z',
};

const state = {
  policy,
  eligibleBreakGlassAdmins: [{ userId: 'ok-3', name: 'Olive Admin', email: 'olive@example.com' }],
  ineligibleBreakGlassUsers: [
    { userId: 'stale-1', name: 'Stan Stale', email: 'stan@example.com', reason: 'no_two_factor' as const },
    { userId: 'ghost-2', reason: 'not_found' as const },
  ],
  hasConfiguredSsoProvider: true,
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('LoginPolicySettings stale break-glass ids', () => {
  it('lists stored-but-ineligible ids with a reason and removes one from the payload', async () => {
    actions.get.mockResolvedValue(state);
    actions.update.mockResolvedValue({
      success: true,
      state: {
        ...state,
        policy: { ...policy, passwordBreakGlassUserIds: ['ghost-2', 'ok-3'] },
        ineligibleBreakGlassUsers: [state.ineligibleBreakGlassUsers[1]],
      },
    });

    render(<LoginPolicySettings />);

    const staleRow = await waitFor(() => {
      const el = document.getElementById('login-policy-break-glass-stale-stale-1');
      expect(el).not.toBeNull();
      return el as HTMLElement;
    });
    expect(staleRow.textContent).toContain('Stan Stale (stan@example.com)');
    expect(staleRow.textContent).toContain('No longer eligible.');
    expect(staleRow.textContent).toContain('Two-factor authentication was reset or is missing.');
    // Unknown user falls back to the bare id.
    expect(document.getElementById('login-policy-break-glass-stale-ghost-2')!.textContent).toContain('ghost-2');

    fireEvent.click(document.getElementById('login-policy-break-glass-remove-stale-1')!);

    await waitFor(() => expect(actions.update).toHaveBeenCalledTimes(1));
    expect(actions.update).toHaveBeenCalledWith({ passwordBreakGlassUserIds: ['ghost-2', 'ok-3'] });

    await waitFor(() =>
      expect(document.getElementById('login-policy-break-glass-stale-stale-1')).toBeNull(),
    );
    expect(screen.queryByText('Stan Stale (stan@example.com)')).toBeNull();
    expect(document.getElementById('login-policy-break-glass-stale-ghost-2')).not.toBeNull();
  });
});
