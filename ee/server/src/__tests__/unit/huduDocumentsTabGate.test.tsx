// @vitest-environment jsdom
/**
 * T243/T245 — registration gating for the Documents page "Hudu" tab
 * (global-docs group), mirroring huduClientTabGate.test.tsx:
 * useHuduDocumentsTab (packages/documents) resolves visible ONLY when EE
 * edition + `hudu-integration` flag AND the edition-swapped probe
 * (getHuduConnectionStatus — the existing settings status action, reused as
 * the connected-only probe) reports Hudu connected. DocumentsPage renders the
 * CustomTabs switcher only when `visible` is true, so hidden here = no trace
 * of the tab. T245 pins the CE isolation: the packages/ee stubs resolve
 * hidden / render null, and the CE wrapper only ever imports `@enterprise`.
 */
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useHuduDocumentsTab } from '@alga-psa/documents/components/useHuduDocumentsTab';
// @ts-expect-error Vite raw import (source-wiring assertion).
import documentsPageSource from '@alga-psa/documents/components/DocumentsPage.tsx?raw';
// @ts-expect-error Vite raw import (source-wiring assertion).
import ceWrapperSource from '@alga-psa/documents/components/HuduDocumentsTab.tsx?raw';

const { useFeatureFlagMock, isEnterpriseRef, getHuduConnectionStatusMock } = vi.hoisted(() => ({
  useFeatureFlagMock: vi.fn(),
  isEnterpriseRef: { value: true },
  getHuduConnectionStatusMock: vi.fn(),
}));

vi.mock('@alga-psa/ui/hooks', () => ({
  useFeatureFlag: useFeatureFlagMock,
}));

vi.mock('@alga-psa/core', () => ({
  get isEnterprise() {
    return isEnterpriseRef.value;
  },
}));

// The hook's dynamic `@enterprise/...` import (vitest aliases it to the
// packages/ee CE stub; webpack swaps it per edition at build time).
vi.mock('@enterprise/lib/actions/integrations/huduActions', () => ({
  getHuduConnectionStatus: getHuduConnectionStatusMock,
}));

function connectedStatus(connected: boolean) {
  return {
    success: true as const,
    data: {
      connected,
      isActive: connected,
      baseUrl: connected ? 'https://docs.example.com' : null,
      connectedAt: null,
      lastSyncedAt: null,
      passwordAccess: false,
    },
  };
}

function Probe() {
  const gate = useHuduDocumentsTab();
  return (
    <div
      data-testid="hudu-docs-gate"
      data-visible={String(gate.visible)}
      data-loading={String(gate.loading)}
    />
  );
}

async function renderGate() {
  render(<Probe />);
  const gate = screen.getByTestId('hudu-docs-gate');
  await waitFor(() => {
    expect(gate.getAttribute('data-loading')).toBe('false');
  });
  return gate;
}

beforeEach(() => {
  useFeatureFlagMock.mockReset();
  getHuduConnectionStatusMock.mockReset();
  isEnterpriseRef.value = true;
  useFeatureFlagMock.mockReturnValue({ enabled: true, loading: false, error: null });
  getHuduConnectionStatusMock.mockResolvedValue(connectedStatus(true));
});

describe('T243: useHuduDocumentsTab registration gate', () => {
  it('is hidden and never probes when the feature flag is off', async () => {
    useFeatureFlagMock.mockReturnValue({ enabled: false, loading: false, error: null });

    const gate = await renderGate();

    expect(gate.getAttribute('data-visible')).toBe('false');
    expect(getHuduConnectionStatusMock).not.toHaveBeenCalled();
    expect(useFeatureFlagMock).toHaveBeenCalledWith('hudu-integration', { defaultValue: false });
  });

  it('is hidden and never probes in Community Edition even with the flag on', async () => {
    isEnterpriseRef.value = false;

    const gate = await renderGate();

    expect(gate.getAttribute('data-visible')).toBe('false');
    expect(getHuduConnectionStatusMock).not.toHaveBeenCalled();
  });

  it('is hidden when Hudu is not connected', async () => {
    getHuduConnectionStatusMock.mockResolvedValue(connectedStatus(false));

    const gate = await renderGate();

    expect(gate.getAttribute('data-visible')).toBe('false');
    expect(getHuduConnectionStatusMock).toHaveBeenCalledTimes(1);
  });

  it('is hidden when the status action returns a failure envelope', async () => {
    getHuduConnectionStatusMock.mockResolvedValue({ success: false, error: 'boom' });

    const gate = await renderGate();

    expect(gate.getAttribute('data-visible')).toBe('false');
  });

  it('resolves hidden (without throwing) when the probe rejects', async () => {
    getHuduConnectionStatusMock.mockRejectedValue(new Error('boom'));

    const gate = await renderGate();

    expect(gate.getAttribute('data-visible')).toBe('false');
  });

  it('is visible when EE + flag + connected all hold', async () => {
    const gate = await renderGate();

    await waitFor(() => {
      expect(gate.getAttribute('data-visible')).toBe('true');
    });
    expect(getHuduConnectionStatusMock).toHaveBeenCalledTimes(1);
  });

  it('is hidden while the probe is still in flight', async () => {
    let resolveProbe: (value: ReturnType<typeof connectedStatus>) => void = () => undefined;
    getHuduConnectionStatusMock.mockReturnValue(
      new Promise((resolve) => {
        resolveProbe = resolve;
      })
    );

    render(<Probe />);
    const gate = screen.getByTestId('hudu-docs-gate');

    await waitFor(() => {
      expect(gate.getAttribute('data-loading')).toBe('true');
    });
    expect(gate.getAttribute('data-visible')).toBe('false');

    resolveProbe(connectedStatus(true));
    await waitFor(() => {
      expect(gate.getAttribute('data-visible')).toBe('true');
    });
  });

  it('wiring: DocumentsPage renders the tabs switcher only inside the visible gate, native view default', () => {
    const source: string = documentsPageSource;

    expect(source).toContain("import { useHuduDocumentsTab } from './useHuduDocumentsTab'");
    expect(source).toContain("import HuduDocumentsTab from './HuduDocumentsTab'");
    expect(source).toContain('const huduDocsTab = useHuduDocumentsTab();');
    expect(source).toContain('{huduDocsTab.visible ? (');
    expect(source).toContain('<HuduDocumentsTab />');

    // The native documents view is the first (default) tab and the fallback
    // when the gate is hidden.
    const gateIdx = source.indexOf('{huduDocsTab.visible ? (');
    const documentsTabIdx = source.indexOf("id: 'documents',", gateIdx);
    const huduTabIdx = source.indexOf("id: 'hudu',", gateIdx);
    const fallbackIdx = source.indexOf('documentsView\n      )}', gateIdx);
    expect(gateIdx).toBeGreaterThan(-1);
    expect(documentsTabIdx).toBeGreaterThan(gateIdx);
    expect(huduTabIdx).toBeGreaterThan(documentsTabIdx);
    expect(fallbackIdx).toBeGreaterThan(huduTabIdx);
  });
});

describe('T245: CE isolation — packages/ee stubs and the edition-swapped wrapper', () => {
  it('the CE action stub reports not connected (gate resolves hidden)', async () => {
    // importActual bypasses the vi.mock above and reaches the real CE stub.
    const stub = (await vi.importActual(
      '@enterprise/lib/actions/integrations/huduActions'
    )) as typeof import('../../../../../packages/ee/src/lib/actions/integrations/huduActions');

    await expect(stub.getHuduConnectionStatus()).resolves.toEqual({
      success: true,
      data: {
        connected: false,
        isActive: false,
        baseUrl: null,
        connectedAt: null,
        lastSyncedAt: null,
        passwordAccess: false,
      },
    });
  });

  it('the CE component stub renders nothing', async () => {
    const stub = await import('@enterprise/components/integrations/hudu/HuduDocumentsTab');

    expect(stub.default).toBe(stub.HuduDocumentsTab);
    const { container } = render(<stub.HuduDocumentsTab />);
    expect(container.innerHTML).toBe('');
  });

  it('the CE wrapper only ever imports the @enterprise alias (no direct EE module paths)', () => {
    const source: string = ceWrapperSource;

    expect(source).toContain("import('@enterprise/components/integrations/hudu/HuduDocumentsTab')");
    expect(source).not.toMatch(/from\s+['"][^'"]*ee\/server/);
    expect(source).not.toMatch(/import\(\s*['"][^'"]*ee\/server/);
  });
});
