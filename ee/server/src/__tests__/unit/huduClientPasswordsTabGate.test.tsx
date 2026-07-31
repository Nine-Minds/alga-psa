// @vitest-environment jsdom
/**
 * T080 — registration gating for the client "Passwords" tab
 * (client-passwords-tab group). Same gate as the Hudu tab: useHuduClientTab
 * (packages/clients) resolves visible ONLY when EE edition AND the
 * edition-swapped probe reports Hudu
 * connected + this client mapped. ClientDetails registers BOTH Hudu tabs in
 * the same `visible`-gated spread, so hidden here = both tabs absent. A
 * registration probe mirrors that spread, and a source-wiring check
 * (ClientDetails.inboundDestination.wiring precedent) pins the real
 * ClientDetails registration.
 */
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useHuduClientTab } from '@alga-psa/clients/components/clients/useHuduClientTab';
// @ts-expect-error Vite raw import (source-wiring assertion).
import clientDetailsSource from '@alga-psa/clients/components/clients/ClientDetails.tsx?raw';

const { isEnterpriseRef, getHuduClientContextMock } = vi.hoisted(() => ({
  isEnterpriseRef: { value: true },
  getHuduClientContextMock: vi.fn(),
}));

vi.mock('@alga-psa/core', () => ({
  get isEnterprise() {
    return isEnterpriseRef.value;
  },
}));

vi.mock('@enterprise/lib/actions/integrations/huduDataActions', () => ({
  getHuduClientContext: getHuduClientContextMock,
}));

const CLIENT_ID = '11111111-1111-1111-1111-111111111111';

/** Mirrors the ClientDetails registration: both Hudu tabs in one gated spread. */
function TabsProbe({ clientId = CLIENT_ID }: { clientId?: string }) {
  const gate = useHuduClientTab(clientId);
  const tabs = [
    { id: 'details', label: 'Details' },
    ...(gate.visible
      ? [
          { id: 'hudu', label: 'Hudu' },
          { id: 'hudu-passwords', label: 'Passwords' },
        ]
      : []),
  ];
  return (
    <div data-testid="hudu-tabs" data-loading={String(gate.loading)}>
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
  isEnterpriseRef.value = true;
  getHuduClientContextMock.mockResolvedValue({ connected: true, mapped: true });
});

describe('T080: client "Passwords" tab registration gate', () => {
  it('is absent in Community Edition', async () => {
    isEnterpriseRef.value = false;

    await renderTabs();

    expect(passwordsTab()).toBeNull();
    expect(getHuduClientContextMock).not.toHaveBeenCalled();
  });

  it('is absent when Hudu is not connected', async () => {
    getHuduClientContextMock.mockResolvedValue({ connected: false, mapped: false });

    await renderTabs();

    expect(passwordsTab()).toBeNull();
    expect(getHuduClientContextMock).toHaveBeenCalledWith(CLIENT_ID);
  });

  it('is absent when the client is not mapped', async () => {
    getHuduClientContextMock.mockResolvedValue({ connected: true, mapped: false });

    await renderTabs();

    expect(passwordsTab()).toBeNull();
  });

  it('is absent (without throwing) when the probe fails', async () => {
    getHuduClientContextMock.mockRejectedValue(new Error('boom'));

    await renderTabs();

    expect(passwordsTab()).toBeNull();
  });

  it('appears directly after the Hudu tab when EE + connected + mapped', async () => {
    const tabs = await renderTabs();

    await waitFor(() => {
      expect(passwordsTab()).toBeTruthy();
    });
    expect(passwordsTab()?.textContent).toBe('Passwords');
    const ids = Array.from(tabs.querySelectorAll('[data-testid^="tab-"]')).map((el) =>
      el.getAttribute('data-testid')
    );
    expect(ids).toEqual(['tab-details', 'tab-hudu', 'tab-hudu-passwords']);
  });

  it('wiring: ClientDetails registers the hudu-passwords tab inside the same visible-gated spread', () => {
    const source: string = clientDetailsSource;

    expect(source).toContain("...(huduClientTab.visible ? [{");
    expect(source).toContain("id: 'hudu-passwords',");
    expect(source).toContain("t('clientDetails.huduPasswordsTab', { defaultValue: 'Passwords' })");
    expect(source).toContain('<HuduClientPasswordsTab clientId={client.client_id} />');

    // Both tabs live in the one gated spread, Passwords directly after Hudu.
    const gateIdx = source.indexOf('...(huduClientTab.visible ? [{');
    const huduIdx = source.indexOf("id: 'hudu',", gateIdx);
    const passwordsIdx = source.indexOf("id: 'hudu-passwords',", gateIdx);
    const closeIdx = source.indexOf('}] : [])', gateIdx);
    expect(gateIdx).toBeGreaterThan(-1);
    expect(huduIdx).toBeGreaterThan(gateIdx);
    expect(passwordsIdx).toBeGreaterThan(huduIdx);
    expect(closeIdx).toBeGreaterThan(passwordsIdx);
  });
});
