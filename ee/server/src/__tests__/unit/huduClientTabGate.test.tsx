// @vitest-environment jsdom
/**
 * T070 — registration gating for the client "Hudu" tab (client-hudu-tab
 * group): useHuduClientTab (packages/clients) resolves visible ONLY when
 * EE edition + `hudu-integration` flag AND the edition-swapped probe reports
 * Hudu connected + this client mapped. ClientDetails registers the tab in its
 * tabs array only when `visible` is true, so hidden here = tab absent.
 */
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useHuduClientTab } from '@alga-psa/clients/components/clients/useHuduClientTab';

const { useFeatureFlagMock, isEnterpriseRef, getHuduClientContextMock } = vi.hoisted(() => ({
  useFeatureFlagMock: vi.fn(),
  isEnterpriseRef: { value: true },
  getHuduClientContextMock: vi.fn(),
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
vi.mock('@enterprise/lib/actions/integrations/huduDataActions', () => ({
  getHuduClientContext: getHuduClientContextMock,
}));

const CLIENT_ID = '11111111-1111-1111-1111-111111111111';

function Probe({ clientId = CLIENT_ID }: { clientId?: string }) {
  const gate = useHuduClientTab(clientId);
  return (
    <div
      data-testid="hudu-gate"
      data-visible={String(gate.visible)}
      data-loading={String(gate.loading)}
    />
  );
}

async function renderGate(clientId?: string) {
  render(<Probe clientId={clientId} />);
  const gate = screen.getByTestId('hudu-gate');
  await waitFor(() => {
    expect(gate.getAttribute('data-loading')).toBe('false');
  });
  return gate;
}

beforeEach(() => {
  useFeatureFlagMock.mockReset();
  getHuduClientContextMock.mockReset();
  isEnterpriseRef.value = true;
  useFeatureFlagMock.mockReturnValue({ enabled: true, loading: false, error: null });
  getHuduClientContextMock.mockResolvedValue({ connected: true, mapped: true });
});

describe('T070: useHuduClientTab registration gate', () => {
  it('is hidden and never probes when the feature flag is off', async () => {
    useFeatureFlagMock.mockReturnValue({ enabled: false, loading: false, error: null });

    const gate = await renderGate();

    expect(gate.getAttribute('data-visible')).toBe('false');
    expect(getHuduClientContextMock).not.toHaveBeenCalled();
    expect(useFeatureFlagMock).toHaveBeenCalledWith('hudu-integration', { defaultValue: false });
  });

  it('is hidden and never probes in Community Edition even with the flag on', async () => {
    isEnterpriseRef.value = false;

    const gate = await renderGate();

    expect(gate.getAttribute('data-visible')).toBe('false');
    expect(getHuduClientContextMock).not.toHaveBeenCalled();
  });

  it('is hidden when Hudu is not connected', async () => {
    getHuduClientContextMock.mockResolvedValue({ connected: false, mapped: false });

    const gate = await renderGate();

    expect(gate.getAttribute('data-visible')).toBe('false');
    expect(getHuduClientContextMock).toHaveBeenCalledWith(CLIENT_ID);
  });

  it('is hidden when the client is not mapped', async () => {
    getHuduClientContextMock.mockResolvedValue({ connected: true, mapped: false });

    const gate = await renderGate();

    expect(gate.getAttribute('data-visible')).toBe('false');
  });

  it('is visible when EE + flag + connected + mapped all hold', async () => {
    const gate = await renderGate();

    await waitFor(() => {
      expect(gate.getAttribute('data-visible')).toBe('true');
    });
    expect(getHuduClientContextMock).toHaveBeenCalledWith(CLIENT_ID);
  });

  it('resolves hidden (without throwing) when the probe fails', async () => {
    getHuduClientContextMock.mockRejectedValue(new Error('boom'));

    const gate = await renderGate();

    expect(gate.getAttribute('data-visible')).toBe('false');
  });

  it('is hidden while the probe is still in flight', async () => {
    let resolveProbe: (value: { connected: boolean; mapped: boolean }) => void = () => undefined;
    getHuduClientContextMock.mockReturnValue(
      new Promise((resolve) => {
        resolveProbe = resolve;
      })
    );

    render(<Probe />);
    const gate = screen.getByTestId('hudu-gate');

    await waitFor(() => {
      expect(gate.getAttribute('data-loading')).toBe('true');
    });
    expect(gate.getAttribute('data-visible')).toBe('false');

    resolveProbe({ connected: true, mapped: true });
    await waitFor(() => {
      expect(gate.getAttribute('data-visible')).toBe('true');
    });
  });
});
