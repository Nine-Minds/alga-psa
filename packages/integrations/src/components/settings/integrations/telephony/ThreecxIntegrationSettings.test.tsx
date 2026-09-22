// @vitest-environment jsdom
import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ThreecxCardState } from '../../../../actions/integrations/telephonyActions';

const mocks = vi.hoisted(() => ({
  cardState: null as ThreecxCardState | null,
  getCardState: vi.fn(),
  setProviderEnabled: vi.fn(async (): Promise<any> => ({ success: true })),
  setAutoCreate: vi.fn(async (): Promise<any> => ({ success: true })),
  rotate: vi.fn(async (): Promise<any> => ({ success: true, apiKey: 'rotated-full-key' })),
  download: vi.fn(async (): Promise<any> => ({ success: true, xml: '<Crm/>', filename: 'algapsa-3cx-abc.xml', contentType: 'application/xml' })),
  ok: vi.fn(async (): Promise<any> => ({ success: true })),
  listQueue: vi.fn(async (): Promise<any> => ({ success: true, items: [] })),
  listTargets: vi.fn(async (): Promise<any> => ({ success: true, targets: [] })),
}));

vi.mock('next/navigation', () => ({ useSearchParams: () => ({ get: () => null }) }));

vi.mock('@alga-psa/ui/components/ClientPicker', () => ({
  ClientPicker: ({ id, clients, onSelect, selectedClientId, disabled }: any) => (
    <select
      id={id}
      value={selectedClientId ?? ''}
      disabled={disabled}
      onChange={(event) => onSelect(event.target.value || null)}
    >
      <option value="">—</option>
      {(clients ?? []).map((client: any) => (
        <option key={client.client_id} value={client.client_id}>{client.client_name}</option>
      ))}
    </select>
  ),
}));

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
  saveThreecxPbxCredentials: mocks.ok,
  testThreecxPbxConnection: mocks.ok,
  clearThreecxPbxCredentials: mocks.ok,
  syncThreecxExtensions: mocks.ok,
  setThreecxExtensionUser: mocks.ok,
  setThreecxCallHistoryImport: mocks.ok,
  setThreecxPhonebookSync: mocks.ok,
  runThreecxPhonebookPush: mocks.ok,
  runThreecxPhonebookImport: mocks.ok,
  mapThreecxContactToClient: mocks.ok,
  completeThreecxPendingContact: mocks.ok,
  dismissThreecxPendingContact: mocks.ok,
  listThreecxContactQueue: mocks.listQueue,
  listTelephonyResolutionTargets: mocks.listTargets,
}));

import { ThreecxIntegrationSettings } from './ThreecxIntegrationSettings';

function cardState(over: Partial<ThreecxCardState> = {}): ThreecxCardState {
  return {
    success: true,
    available: true,
    canManage: true,
    status: 'active',
    autoCreateTickets: false,
    keyLastFour: 'wxyz',
    keyRotatedAt: null,
    templateVersion: 2,
    currentTemplateVersion: 2,
    endpointBaseUrl: 'https://app.example.com/api/telephony/3cx/abcdef012345/',
    pbx: {
      baseUrl: null,
      clientId: null,
      hasClientSecret: false,
      status: 'not_configured',
      lastCheckedAt: null,
      lastError: null,
      capabilities: { xapi: false, callControl: false },
    },
    extensions: [],
    extensionsSyncedAt: null,
    cdr: { enabled: false, lookbackDays: 30, watermark: null, lastRunAt: null, lastRunAdded: 0 },
    phonebook: { enabled: false, schedule: 'daily', lastPushAt: null, lastImportAt: null, lastPushCounts: null, lastImportCounts: null, lastError: null },
    users: [{ userId: 'u1', name: 'Alice', email: 'alice@example.com' }],
    ...over,
  };
}

const connectedPbx = (): ThreecxCardState['pbx'] => ({
  baseUrl: 'https://pbx.example.com',
  clientId: '900',
  hasClientSecret: true,
  status: 'connected',
  lastCheckedAt: '2026-09-15T10:00:00Z',
  lastError: null,
  capabilities: { xapi: true, callControl: true },
});

describe('ThreecxIntegrationSettings', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    mocks.getCardState.mockResolvedValue(cardState());
    mocks.setProviderEnabled.mockResolvedValue({ success: true });
    mocks.rotate.mockResolvedValue({ success: true, apiKey: 'rotated-full-key' });
    mocks.download.mockResolvedValue({ success: true, xml: '<Crm/>', filename: 'algapsa-3cx-abc.xml', contentType: 'application/xml' });
  });

  afterEach(() => cleanup());

  it('T103: when the provider is available the panel renders', async () => {
    render(<ThreecxIntegrationSettings />);
    expect(await screen.findByText('3CX')).toBeTruthy();
  });

  it('T104/T069: when the server reports the provider unavailable (tier below Pro) the panel is hidden', async () => {
    mocks.getCardState.mockResolvedValue(cardState({ available: false, reason: 'tier_required' }));
    const { container } = render(<ThreecxIntegrationSettings />);
    await waitFor(() => expect(mocks.getCardState).toHaveBeenCalled());
    expect(container.querySelector('#threecx-integration-settings')).toBeNull();
  });

  it('T106: shows the endpoint base URL with the tenant slug and a copy button', async () => {
    const { container } = render(<ThreecxIntegrationSettings />);
    await screen.findByText('3CX');
    await waitFor(() =>
      expect(container.querySelector('#threecx-endpoint-url')?.textContent).toContain('abcdef012345'),
    );
    expect(screen.getByRole('button', { name: 'Copy' })).toBeTruthy();
  });

  it('T107: shows the key masked to its last four with a Rotate button', async () => {
    const { container } = render(<ThreecxIntegrationSettings />);
    await screen.findByText('3CX');
    await waitFor(() =>
      expect(container.querySelector('#threecx-api-key-masked')?.textContent).toContain('wxyz'),
    );
    expect(screen.getByRole('button', { name: 'Rotate' })).toBeTruthy();
  });

  it('T108: Enable calls setTelephonyProviderEnabled with provider 3cx', async () => {
    mocks.getCardState.mockResolvedValue(cardState({ status: 'disabled', keyLastFour: null }));
    render(<ThreecxIntegrationSettings />);
    const enable = await screen.findByRole('button', { name: 'Enable' });
    fireEvent.click(enable);
    await waitFor(() => expect(mocks.setProviderEnabled).toHaveBeenCalledWith({ provider: '3cx', enabled: true }));
  });

  it('T109: Auto-create tickets calls setTelephonyAutoCreateTickets with provider 3cx', async () => {
    const { container } = render(<ThreecxIntegrationSettings />);
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
    const { container } = render(<ThreecxIntegrationSettings />);
    const enable = await screen.findByRole('button', { name: 'Enable' });
    fireEvent.click(enable);
    await waitFor(() => expect(container.querySelector('#threecx-full-key-value')?.textContent).toBe('brand-new-full-key'));
    expect(container.querySelector('#threecx-full-key')?.textContent).toMatch(/not be shown again/i);
  });

  it('T111: after Rotate returns a new key the card shows it once', async () => {
    const { container } = render(<ThreecxIntegrationSettings />);
    const rotate = await screen.findByRole('button', { name: 'Rotate' });
    fireEvent.click(rotate);
    await waitFor(() => expect(container.querySelector('#threecx-full-key-value')?.textContent).toBe('rotated-full-key'));
  });

  it('T112: every interactive element in the source carries a kebab-case id', () => {
    const source = fs.readFileSync(path.resolve(__dirname, 'ThreecxIntegrationSettings.tsx'), 'utf8');
    // Each <Button ...> and <Switch ...> opening tag declares a kebab-case id.
    const controls = source.match(/<(Button|Switch)\b[^>]*>/g) ?? [];
    expect(controls.length).toBeGreaterThan(0);
    for (const control of controls) {
      // Static ids, or template-literal ids with a kebab-case prefix per row.
      const id = control.match(/id="([^"]+)"/) ?? control.match(/id=\{`([a-z0-9-]+)\$\{[^}]+\}`\}/);
      expect(id, `missing id on ${control}`).toBeTruthy();
      expect(id![1]).toMatch(/^[a-z0-9-]+$/);
    }
  });

  it('T113: without canManage the controls are disabled and the permission message shows', async () => {
    mocks.getCardState.mockResolvedValue(cardState({ canManage: false }));
    const { container } = render(<ThreecxIntegrationSettings />);
    await screen.findByText('3CX');
    await waitFor(() => expect(container.querySelector('#threecx-permission-message')).toBeTruthy());
    expect((screen.getByRole('button', { name: 'Disable' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Rotate' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Download template' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('T220: the PBX section saves credentials with a write-only secret and shows capability chips', async () => {
    mocks.getCardState.mockResolvedValue(cardState({ pbx: connectedPbx() }));
    const { container } = render(<ThreecxIntegrationSettings />);
    await screen.findByText('3CX');
    await waitFor(() => expect(container.querySelector('#threecx-pbx-section')).toBeTruthy());
    expect(container.querySelector('#threecx-pbx-client-secret')).toBeNull();
    expect(container.querySelector('#threecx-pbx-client-secret-masked')).toBeTruthy();
    expect(container.querySelector('#threecx-pbx-capability-callcontrol')?.textContent).toContain('granted');
    fireEvent.click(screen.getByRole('button', { name: 'Replace' }));
    await waitFor(() => expect(container.querySelector('#threecx-pbx-client-secret')).toBeTruthy());
    fireEvent.change(container.querySelector('#threecx-pbx-client-secret')!, { target: { value: 'shh' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save credentials' }));
    await waitFor(() => expect(mocks.ok).toHaveBeenCalledWith({ baseUrl: 'https://pbx.example.com', clientId: '900', clientSecret: 'shh' }));
    fireEvent.click(screen.getByRole('button', { name: 'Test connection' }));
    await waitFor(() => expect(mocks.ok).toHaveBeenCalledTimes(2));
  });

  it('T220: capability chips read not granted and the dependent sections show the hint when the PBX is not connected', async () => {
    const { container } = render(<ThreecxIntegrationSettings />);
    await screen.findByText('3CX');
    await waitFor(() => expect(container.querySelector('#threecx-pbx-section')).toBeTruthy());
    expect(container.querySelector('#threecx-pbx-capability-xapi')?.textContent).toContain('not granted');
    expect(container.querySelectorAll('#threecx-pbx-not-connected-hint').length).toBe(3);
    expect(container.querySelector('#threecx-extensions-table')).toBeNull();
  });

  it('T221: the Extensions table highlights unmapped rows and maps a user through the picker', async () => {
    mocks.getCardState.mockResolvedValue(cardState({
      pbx: connectedPbx(),
      extensions: [
        { dn: '101', pbxDisplayName: 'Ann', pbxEmail: 'ann@example.com', userId: null, mappedBy: null },
        { dn: '102', pbxDisplayName: 'Bob', pbxEmail: 'bob@example.com', userId: 'u1', mappedBy: 'auto' },
      ],
    }));
    const { container } = render(<ThreecxIntegrationSettings />);
    await screen.findByText('3CX');
    await waitFor(() => expect(container.querySelector('#threecx-extensions-table')).toBeTruthy());
    expect(container.querySelector('#threecx-extension-row-101')?.className).toContain('badge-warning');
    expect(container.querySelector('#threecx-extension-row-102')?.className).not.toContain('badge-warning');
    fireEvent.click(screen.getByRole('button', { name: 'Sync from PBX' }));
    await waitFor(() => expect(mocks.ok).toHaveBeenCalled());
  });

  it('T222/T223: call-history and phonebook controls call their actions', async () => {
    mocks.getCardState.mockResolvedValue(cardState({ pbx: connectedPbx() }));
    const { container } = render(<ThreecxIntegrationSettings />);
    await screen.findByText('3CX');
    await waitFor(() => expect(container.querySelector('#threecx-cdr-toggle')).toBeTruthy());
    fireEvent.click(container.querySelector('#threecx-cdr-toggle')!);
    await waitFor(() => expect(mocks.ok).toHaveBeenCalledWith({ enabled: true, lookbackDays: 30 }));
    fireEvent.click(screen.getByRole('button', { name: 'Push now' }));
    await waitFor(() => expect(mocks.ok).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getByRole('button', { name: 'Import now' }));
    await waitFor(() => expect(mocks.ok).toHaveBeenCalledTimes(3));
    fireEvent.click(container.querySelector('#threecx-phonebook-toggle')!);
    await waitFor(() => expect(mocks.ok).toHaveBeenCalledWith({ enabled: true, schedule: 'daily' }));
  });

  it('T224: the contact queue lists unmapped and pending rows; Apply maps, Complete opens the dialog', async () => {
    mocks.listQueue.mockResolvedValue({
      success: true,
      items: [
        { kind: 'unmapped', contactId: 'c1', fullName: 'Jane Roe', email: 'jane@x.com', companyName: 'Acme', suggestedClientId: 'cl1', suggestedClientName: 'Acme Inc' },
        { kind: 'pending', pendingId: 'p1', firstName: 'No', lastName: 'Mail', number: '+15550001111', companyName: '', suggestedClientId: null, suggestedClientName: null },
      ],
    });
    const { container } = render(<ThreecxIntegrationSettings />);
    await screen.findByText('3CX');
    await waitFor(() => expect(container.querySelector('#threecx-contact-queue-row-c1')).toBeTruthy());
    expect(container.querySelector('#threecx-contact-queue-row-p1')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    await waitFor(() => expect(mocks.ok).toHaveBeenCalledWith({ contactId: 'c1', clientId: 'cl1' }));
    fireEvent.click(screen.getByRole('button', { name: 'Leave without client' }));
    await waitFor(() => expect(mocks.ok).toHaveBeenCalledWith({ contactId: 'c1', clientId: null }));
    fireEvent.click(screen.getByRole('button', { name: 'Complete' }));
    // The dialog mounts at document level, outside the render container.
    await waitFor(() => expect(document.querySelector('#threecx-complete-email')).toBeTruthy());
    expect((screen.getByRole('button', { name: 'Create contact' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(document.querySelector('#threecx-complete-email')!, { target: { value: 'no.mail@x.com' } });
    await waitFor(() => expect((screen.getByRole('button', { name: 'Create contact' }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: 'Create contact' }));
    await waitFor(() => expect(mocks.ok).toHaveBeenCalledWith(expect.objectContaining({ pendingId: 'p1', email: 'no.mail@x.com', number: '+15550001111' })));
  });

  it('T225: the template-stale hint shows when the uploaded version is older than the current one', async () => {
    mocks.getCardState.mockResolvedValue(cardState({ templateVersion: 1, currentTemplateVersion: 2 }));
    const { container } = render(<ThreecxIntegrationSettings />);
    await screen.findByText('3CX');
    await waitFor(() => expect(container.querySelector('#threecx-template-stale')).toBeTruthy());
  });

  it('T114: the component source wraps every visible string in t()', () => {
    const source = fs.readFileSync(path.resolve(__dirname, 'ThreecxIntegrationSettings.tsx'), 'utf8');
    // Only inspect the JSX return block, so TS generics above it are ignored.
    const jsx = source.slice(source.indexOf('<div className="space-y-6" id="threecx-integration-settings"'));
    // No JSX text node of bare English words between tags — all copy goes through t().
    const bareText = jsx.match(/>\s*[A-Za-z][A-Za-z ]{2,}\s*</g) ?? [];
    expect(bareText).toEqual([]);
  });
});
