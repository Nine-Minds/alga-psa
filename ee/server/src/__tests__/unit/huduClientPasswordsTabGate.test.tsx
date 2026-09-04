// @vitest-environment jsdom
/**
 * T080 — registration gating for the client "Passwords" tab
 * (client-passwords-tab group).
 *
 * Since the credentials vault, the client Passwords surface is gated by
 * `useCredentialsVaultTab` (EE + credentials tier); when that vault gate is
 * ON the unified Passwords tab REPLACES only the legacy Hudu-only Passwords
 * tab. The general "Hudu" client tab (F070) stays registered whenever EE +
 * Hudu connected + this client mapped — the vault gate never removes it.
 * Gate closed ⇒ the legacy Hudu pair (Hudu + Hudu Passwords behind
 * `useHuduClientTab`) is preserved exactly. A registration probe mirrors that
 * spread, and a source-wiring check pins the real ClientDetails registration.
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
} = vi.hoisted(() => ({
  isEnterpriseRef: { value: true },
  getHuduClientContextMock: vi.fn(),
  getCredentialsContextMock: vi.fn(),
}));

vi.mock('@alga-psa/core', () => ({
  get isEnterprise() {
    return isEnterpriseRef.value;
  },
}));

vi.mock('@enterprise/lib/actions/integrations/huduDataActions', () => ({
  getHuduClientContext: getHuduClientContextMock,
}));

vi.mock('@enterprise/lib/actions/credentials/credentialActions', () => ({
  getCredentialsContext: getCredentialsContextMock,
}));

const CLIENT_ID = '11111111-1111-1111-1111-111111111111';

/** Mirrors the ClientDetails registration: Hudu tab always, vault/legacy swap. */
function TabsProbe({ clientId = CLIENT_ID }: { clientId?: string }) {
  const vault = useCredentialsVaultTab();
  const hudu = useHuduClientTab(clientId);
  const tabs = [
    { id: 'details', label: 'Details' },
    ...(hudu.visible
      ? [{ id: 'hudu', label: 'Hudu' }]
      : []),
    ...(vault.visible
      ? [{ id: 'credentials', label: 'Passwords' }]
      : hudu.visible
        ? [{ id: 'hudu-passwords', label: 'Passwords' }]
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
  isEnterpriseRef.value = true;
  // Default: vault gate closed (tier probe false), legacy Hudu gate open.
  getCredentialsContextMock.mockResolvedValue({ tierOk: false, huduConnected: false, flagIrrelevantHere: true });
  getHuduClientContextMock.mockResolvedValue({ connected: true, mapped: true });
});

describe('T080: client "Passwords" tab registration gate', () => {
  it('keeps the general Hudu tab and swaps only the password surface when the vault gate is on', async () => {
    // Vault gate on: EE + tier. The general Hudu tab must remain; only the
    // legacy Hudu Passwords tab is replaced by the unified credentials tab.
    getCredentialsContextMock.mockResolvedValue({ tierOk: true, huduConnected: false, flagIrrelevantHere: true });

    const tabs = await renderTabs();

    await waitFor(() => {
      expect(screen.queryByTestId('tab-credentials')).toBeTruthy();
    });
    expect(screen.queryByTestId('tab-hudu')).toBeTruthy();
    expect(passwordsTab()).toBeNull();
    const ids = Array.from(tabs.querySelectorAll('[data-testid^="tab-"]')).map((el) =>
      el.getAttribute('data-testid')
    );
    expect(ids).toEqual(['tab-details', 'tab-hudu', 'tab-credentials']);
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

  it('wiring: ClientDetails always registers the general Hudu tab; the password surface swaps vault/legacy', () => {
    const source: string = clientDetailsSource;

    // General Hudu tab is registered unconditionally on huduClientTab.visible.
    expect(source).toContain('...(huduClientTab.visible ? [{');
    expect(source).toContain("id: 'hudu',");
    expect(source).toContain('<HuduClientTab clientId={client.client_id} />');

    // Password surface: unified vault tab when visible, else legacy Hudu-only.
    expect(source).toContain('...(credentialsVaultTab.visible ? [{');
    expect(source).toContain("id: 'credentials',");
    expect(source).toContain('<ClientCredentialsTab clientId={client.client_id} />');
    expect(source).toContain('}] : huduClientTab.visible ? [{');
    expect(source).toContain("id: 'hudu-passwords',");
    expect(source).toContain('<HuduClientPasswordsTab clientId={client.client_id} />');

    // Ordering: general hudu spread first, then the password-surface swap.
    const huduIdx = source.indexOf('...(huduClientTab.visible ? [{');
    const vaultIdx = source.indexOf('...(credentialsVaultTab.visible ? [{', huduIdx);
    const legacyIdx = source.indexOf('}] : huduClientTab.visible ? [{', vaultIdx);
    const huduPasswordsIdx = source.indexOf("id: 'hudu-passwords',", legacyIdx);
    const closeIdx = source.indexOf('}] : [])', legacyIdx);
    expect(huduIdx).toBeGreaterThan(-1);
    expect(vaultIdx).toBeGreaterThan(huduIdx);
    expect(legacyIdx).toBeGreaterThan(vaultIdx);
    expect(huduPasswordsIdx).toBeGreaterThan(legacyIdx);
    expect(closeIdx).toBeGreaterThan(huduPasswordsIdx);
  });
});
