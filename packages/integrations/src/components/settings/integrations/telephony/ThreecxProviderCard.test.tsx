// @vitest-environment jsdom
import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ThreecxCardState } from '../../../../actions/integrations/telephonyActions';

const mocks = vi.hoisted(() => ({
  flagEnabled: true,
  cardState: null as ThreecxCardState | null,
  getCardState: vi.fn(),
  setProviderEnabled: vi.fn(async (): Promise<any> => ({ success: true })),
  setAutoCreate: vi.fn(async (): Promise<any> => ({ success: true })),
  rotate: vi.fn(async (): Promise<any> => ({ success: true, apiKey: 'rotated-full-key' })),
  download: vi.fn(async (): Promise<any> => ({ success: true, xml: '<Crm/>', filename: 'algapsa-3cx-abc.xml', contentType: 'application/xml' })),
}));

vi.mock('@alga-psa/ui/hooks', () => ({
  useFeatureFlag: () => ({ enabled: mocks.flagEnabled, loading: false, error: null }),
}));

vi.mock('@alga-psa/core/features', () => ({ RELEASE_V1_6_FEATURE_FLAG: 'release-v1-6-feature' }));

vi.mock('@alga-psa/ui/lib/i18n/client', () => {
  const t = (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key;
  return { useTranslation: () => ({ t }), useFormatters: () => ({ locale: 'en' }) };
});

vi.mock('../../../../actions/integrations/telephonyActions', () => ({
  getThreecxCardState: mocks.getCardState,
  setTelephonyProviderEnabled: mocks.setProviderEnabled,
  setTelephonyAutoCreateTickets: mocks.setAutoCreate,
  rotateThreecxApiKey: mocks.rotate,
  downloadThreecxTemplate: mocks.download,
}));

import { ThreecxProviderCard } from './ThreecxProviderCard';

function cardState(over: Partial<ThreecxCardState> = {}): ThreecxCardState {
  return {
    success: true,
    available: true,
    canManage: true,
    status: 'active',
    autoCreateTickets: false,
    keyLastFour: 'wxyz',
    keyRotatedAt: null,
    templateVersion: 1,
    endpointBaseUrl: 'https://app.example.com/api/telephony/3cx/abcdef012345/',
    ...over,
  };
}

describe('ThreecxProviderCard', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    mocks.flagEnabled = true;
    mocks.getCardState.mockResolvedValue(cardState());
    mocks.setProviderEnabled.mockResolvedValue({ success: true });
    mocks.rotate.mockResolvedValue({ success: true, apiKey: 'rotated-full-key' });
    mocks.download.mockResolvedValue({ success: true, xml: '<Crm/>', filename: 'algapsa-3cx-abc.xml', contentType: 'application/xml' });
  });

  afterEach(() => cleanup());

  it('T102: with the flag off the card renders nothing', () => {
    mocks.flagEnabled = false;
    const { container } = render(<ThreecxProviderCard />);
    expect(container.querySelector('#telephony-provider-card-3cx')).toBeNull();
    expect(mocks.getCardState).not.toHaveBeenCalled();
  });

  it('T103: with the flag on and the provider available the card renders', async () => {
    render(<ThreecxProviderCard />);
    expect(await screen.findByText('3CX')).toBeTruthy();
  });

  it('T104/T069: when the server reports the provider unavailable (tier below Pro) the card is hidden', async () => {
    mocks.getCardState.mockResolvedValue(cardState({ available: false, reason: 'tier_required' }));
    const { container } = render(<ThreecxProviderCard />);
    await waitFor(() => expect(mocks.getCardState).toHaveBeenCalled());
    expect(container.querySelector('#telephony-provider-card-3cx')).toBeNull();
  });

  it('T106: shows the endpoint base URL with the tenant slug and a copy button', async () => {
    const { container } = render(<ThreecxProviderCard />);
    await screen.findByText('3CX');
    await waitFor(() =>
      expect(container.querySelector('#threecx-endpoint-url')?.textContent).toContain('abcdef012345'),
    );
    expect(screen.getByRole('button', { name: 'Copy' })).toBeTruthy();
  });

  it('T107: shows the key masked to its last four with a Rotate button', async () => {
    const { container } = render(<ThreecxProviderCard />);
    await screen.findByText('3CX');
    await waitFor(() =>
      expect(container.querySelector('#threecx-api-key-masked')?.textContent).toContain('wxyz'),
    );
    expect(screen.getByRole('button', { name: 'Rotate' })).toBeTruthy();
  });

  it('T108: Enable calls setTelephonyProviderEnabled with provider 3cx', async () => {
    mocks.getCardState.mockResolvedValue(cardState({ status: 'disabled', keyLastFour: null }));
    render(<ThreecxProviderCard />);
    const enable = await screen.findByRole('button', { name: 'Enable' });
    fireEvent.click(enable);
    await waitFor(() => expect(mocks.setProviderEnabled).toHaveBeenCalledWith({ provider: '3cx', enabled: true }));
  });

  it('T109: Auto-create tickets calls setTelephonyAutoCreateTickets with provider 3cx', async () => {
    const { container } = render(<ThreecxProviderCard />);
    await screen.findByText('3CX');
    const toggle = await waitFor(() => {
      const node = container.querySelector('#threecx-auto-ticket-toggle');
      if (!node) throw new Error('toggle not ready');
      return node;
    });
    fireEvent.click(toggle);
    await waitFor(() => expect(mocks.setAutoCreate).toHaveBeenCalledWith({ provider: '3cx', autoCreateTickets: true }));
  });

  it('T110: after Enable returns a full key the card shows it once with the warning', async () => {
    mocks.getCardState.mockResolvedValue(cardState({ status: 'disabled', keyLastFour: null }));
    mocks.setProviderEnabled.mockResolvedValue({ success: true, apiKey: 'brand-new-full-key' });
    const { container } = render(<ThreecxProviderCard />);
    const enable = await screen.findByRole('button', { name: 'Enable' });
    fireEvent.click(enable);
    await waitFor(() => expect(container.querySelector('#threecx-full-key-value')?.textContent).toBe('brand-new-full-key'));
    expect(container.querySelector('#threecx-full-key')?.textContent).toMatch(/not be shown again/i);
  });

  it('T111: after Rotate returns a new key the card shows it once', async () => {
    const { container } = render(<ThreecxProviderCard />);
    const rotate = await screen.findByRole('button', { name: 'Rotate' });
    fireEvent.click(rotate);
    await waitFor(() => expect(container.querySelector('#threecx-full-key-value')?.textContent).toBe('rotated-full-key'));
  });

  it('T112: every interactive element in the source carries a kebab-case id', () => {
    const source = fs.readFileSync(path.resolve(__dirname, 'ThreecxProviderCard.tsx'), 'utf8');
    // Each <Button ...> and <Switch ...> opening tag declares a kebab-case id.
    const controls = source.match(/<(Button|Switch)\b[^>]*>/g) ?? [];
    expect(controls.length).toBeGreaterThan(0);
    for (const control of controls) {
      const id = control.match(/id="([^"]+)"/);
      expect(id, `missing id on ${control}`).toBeTruthy();
      expect(id![1]).toMatch(/^[a-z0-9-]+$/);
    }
  });

  it('T113: without canManage the controls are disabled and the permission message shows', async () => {
    mocks.getCardState.mockResolvedValue(cardState({ canManage: false }));
    const { container } = render(<ThreecxProviderCard />);
    await screen.findByText('3CX');
    await waitFor(() => expect(container.querySelector('#threecx-permission-message')).toBeTruthy());
    expect((screen.getByRole('button', { name: 'Disable' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Rotate' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Download template' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('T114: the component source wraps every visible string in t()', () => {
    const source = fs.readFileSync(path.resolve(__dirname, 'ThreecxProviderCard.tsx'), 'utf8');
    // Only inspect the JSX return block, so TS generics above it are ignored.
    const jsx = source.slice(source.indexOf('<Card className="relative overflow-hidden"'));
    // No JSX text node of bare English words between tags — all copy goes through t().
    const bareText = jsx.match(/>\s*[A-Za-z][A-Za-z ]{2,}\s*</g) ?? [];
    expect(bareText).toEqual([]);
  });
});
