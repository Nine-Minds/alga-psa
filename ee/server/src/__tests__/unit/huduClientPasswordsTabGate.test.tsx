// @vitest-environment jsdom
/**
 * T080 — registration gating for the client "Passwords" tab
 * (client-passwords-tab group).
 *
 * Since the credentials vault, the client Passwords surface is gated by
 * `useCredentialsVaultTab` (EE + release-v1.5-feature + credentials tier);
 * when that vault gate is ON it REPLACES the legacy Hudu tabs with a single
 * unified Passwords tab. When the vault gate is OFF the legacy Hudu-only
 * registration (Hudu + Hudu Passwords tabs behind `useHuduClientTab`:
 * EE + Hudu connected + this client mapped) is preserved exactly. A
 * registration probe mirrors that spread, and a source-wiring check pins the
 * real ClientDetails registration.
 */
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useHuduClientTab } from '@alga-psa/clients/components/clients/useHuduClientTab';
import { useCredentialsVaultTab } from '@alga-psa/clients/components/clients/useCredentialsVaultTab';
// @ts-expect-error Vite raw import (source-wiring assertion).
import clientDetailsSource from '@alga-psa/clients/components/clients/ClientDetails.tsx?raw';

const {
  isEnterpriseRef,
  getHuduClientContextMock,
  getCredentialsContextMock,
  useFeatureFlagMock,
} = vi.hoisted(() => ({
  isEnterpriseRef: { value: true },
  getHuduClientContextMock: vi.fn(),
  getCredentialsContextMock: vi.fn(),
  useFeatureFlagMock: vi.fn(),
}));

vi.mock('@alga-psa/core', () => ({
  get isEnterprise() {
    return isEnterpriseRef.value;
  },
}));

vi.mock('@alga-psa/ui/hooks', () => ({
  useFeatureFlag: useFeatureFlagMock,
}));

vi.mock('@enterprise/lib/actions/integrations/huduDataActions', () => ({
  getHuduClientContext: getHuduClientContextMock,
}));

vi.mock('@enterprise/lib/actions/credentials/credentialActions', () => ({
  getCredentialsContext: getCredentialsContextMock,
}));

const CLIENT_ID = '11111111-1111-1111-1111-111111111111';

/** Mirrors the ClientDetails registration: vault tab first, legacy fallback. */
function TabsProbe({ clientId = CLIENT_ID }: { clientId?: string }) {
  const vault = useCredentialsVaultTab();
  const hudu = useHuduClientTab(clientId);
  const tabs = [
    { id: 'details', label: 'Details' },
    ...(vault.visible
      ? [{ id: 'credentials', label: 'Passwords' }]
      : hudu.visible
        ? [
            { id: 'hudu', label: 'Hudu' },
            { id: 'hudu-passwords', label: 'Passwords' },
          ]
        : []),
  ];
  return (
    <div data-testid="hudu-tabs" data-loading={String(vault.loading)}>
      {tabs.map((tab) => (
        <span key={tab.id} data-testid={`tab-${tab.id}`}>
          {tab.label}
        </span>
      ))}
    </div>
  );
}

async function renderTabs() {
  render(<TabsProbe />);
  const tabs = screen.getByTestId('hudu-tabs');
  await waitFor(() => {
    expect(tabs.getAttribute('data-loading')).toBe('false');
  });
  return tabs;
}

function passwordsTab() {
  return screen.queryByTestId('tab-hudu-passwords');
}

beforeEach(() => {
  getHuduClientContextMock.mockReset();
  getCredentialsContextMock.mockReset();
  useFeatureFlagMock.mockReset();
  isEnterpriseRef.value = true;
  // Default: vault gate closed (flag off), legacy Hudu gate open.
  useFeatureFlagMock.mockReturnValue({ enabled: false });
  getCredentialsContextMock.mockResolvedValue({ tierOk: false, huduConnected: false, flagIrrelevantHere: true });
  getHuduClientContextMock.mockResolvedValue({ connected: true, mapped: true });
});

describe('T080: client "Passwords" tab registration gate', () => {
  it('renders the unified credentials tab instead of the Hudu pair when the vault gate is on', async () => {
    // Vault gate on: EE + flag + tier.
    useFeatureFlagMock.mockReturnValue({ enabled: true });
    getCredentialsContextMock.mockResolvedValue({ tierOk: true, huduConnected: false, flagIrrelevantHere: true });

    const tabs = await renderTabs();

    await waitFor(() => {
      expect(screen.queryByTestId('tab-credentials')).toBeTruthy();
    });
    expect(passwordsTab()).toBeNull();
    expect(screen.queryByTestId('tab-hudu')).toBeNull();
    const ids = Array.from(tabs.querySelectorAll('[data-testid^="tab-"]')).map((el) =>
      el.getAttribute('data-testid')
    );
    expect(ids).toEqual(['tab-details', 'tab-credentials']);
  });

  it('is absent in Community Edition (both gates closed)', async () => {
    isEnterpriseRef.value = false;

    await renderTabs();

    expect(passwordsTab()).toBeNull();
    expect(screen.queryByTestId('tab-credentials')).toBeNull();
    expect(getHuduClientContextMock).not.toHaveBeenCalled();
    expect(getCredentialsContextMock).not.toHaveBeenCalled();
  });

  it('keeps the legacy Hudu-only Passwords tab when the vault gate is off but Hudu is connected+mapped', async () => {
    const tabs = await renderTabs();

    await waitFor(() => {
      expect(passwordsTab()).toBeTruthy();
    });
    expect(passwordsTab()?.textContent).toBe('Passwords');
    expect(screen.queryByTestId('tab-credentials')).toBeNull();
    const ids = Array.from(tabs.querySelectorAll('[data-testid^="tab-"]')).map((el) =>
      el.getAttribute('data-testid')
    );
    expect(ids).toEqual(['tab-details', 'tab-hudu', 'tab-hudu-passwords']);
  });

  it('is absent when Hudu is not connected and the vault gate is off', async () => {
    getHuduClientContextMock.mockResolvedValue({ connected: false, mapped: false });

    await renderTabs();

    expect(passwordsTab()).toBeNull();
    expect(screen.queryByTestId('tab-credentials')).toBeNull();
    expect(getHuduClientContextMock).toHaveBeenCalledWith(CLIENT_ID);
  });

  it('is absent (without throwing) when both probes fail', async () => {
    getCredentialsContextMock.mockRejectedValue(new Error('boom'));
    getHuduClientContextMock.mockRejectedValue(new Error('boom'));

    await renderTabs();

    expect(passwordsTab()).toBeNull();
    expect(screen.queryByTestId('tab-credentials')).toBeNull();
  });

  it('wiring: ClientDetails registers the vault tab first and the legacy Hudu pair as the fallback', () => {
    const source: string = clientDetailsSource;

    // Vault-first registration.
    expect(source).toContain('...(credentialsVaultTab.visible ? [{');
    expect(source).toContain("id: 'credentials',");
    expect(source).toContain('<ClientCredentialsTab clientId={client.client_id} />');

    // Legacy fallback preserved exactly (Hudu + Hudu Passwords in one gated spread).
    expect(source).toContain('}] : huduClientTab.visible ? [{');
    expect(source).toContain("id: 'hudu',");
    expect(source).toContain("id: 'hudu-passwords',");
    expect(source).toContain("t('clientDetails.huduPasswordsTab', { defaultValue: 'Passwords' })");
    expect(source).toContain('<HuduClientPasswordsTab clientId={client.client_id} />');

    // Ordering: vault spread first, then the legacy hudu spread.
    const vaultIdx = source.indexOf('...(credentialsVaultTab.visible ? [{');
    const legacyIdx = source.indexOf('}] : huduClientTab.visible ? [{', vaultIdx);
    const huduIdx = source.indexOf("id: 'hudu',", legacyIdx);
    const passwordsIdx = source.indexOf("id: 'hudu-passwords',", legacyIdx);
    const closeIdx = source.indexOf('}] : [])', legacyIdx);
    expect(vaultIdx).toBeGreaterThan(-1);
    expect(legacyIdx).toBeGreaterThan(vaultIdx);
    expect(huduIdx).toBeGreaterThan(legacyIdx);
    expect(passwordsIdx).toBeGreaterThan(huduIdx);
    expect(closeIdx).toBeGreaterThan(passwordsIdx);
  });
});
