// @vitest-environment jsdom
/**
 * T030 (tab list, "x of y", New disabled at limit, create dialog saves roles + act-as) and
 * T032 (MCP shared limit) and T036 (below Pro: blocked notice, cleanup-only rows, MCP create gate).
 */
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { interpolate, makeRow } from './spTestHarness';

const m = vi.hoisted(() => ({
  hasFeature: vi.fn(),
  list: vi.fn(),
  usage: vi.fn(),
  options: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  setActive: vi.fn(),
  remove: vi.fn(),
  setRoles: vi.fn(),
  keys: vi.fn(),
  issueKey: vi.fn(),
  rotateKey: vi.fn(),
  revokeKey: vi.fn(),
}));

vi.mock('server/src/context/TierContext', () => ({
  useTier: () => ({ hasFeature: m.hasFeature, isLoading: false }),
}));
// Keep the real upgrade notice and CTA while isolating the TierGate boundary from server context setup.
vi.mock('server/src/components/tier-gating/TierGate', async () => {
  const { FeatureUpgradeNotice } = await import('@alga-psa/ui/components/tier-gating/FeatureUpgradeNotice');
  const ReactModule = await import('react');
  return {
    TierGate: ({ featureName, description, children }: { featureName: string; description?: string; children: React.ReactNode }) =>
      m.hasFeature()
        ? ReactModule.createElement(ReactModule.Fragment, null, children)
        : ReactModule.createElement(FeatureUpgradeNotice, { featureName, description, requiredTier: 'pro' }),
  };
});
const stableT = vi.hoisted(() => ({ t: (key: string, options?: { defaultValue?: string } & Record<string, unknown>) => {
  const shared = key === 'common:yes' ? 'Yes' : key === 'common:no' ? 'No' : key;
  return String(options?.defaultValue ?? shared).replace(/\{\{(\w+)\}\}/g, (_m, n) => String(options?.[n] ?? ''));
} }));
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => stableT,
  useFormatters: () => ({ formatDate: (d: Date) => d.toISOString().slice(0, 10) }),
}));
vi.mock('react-hot-toast', () => ({ toast: { success: vi.fn(), error: vi.fn() }, default: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../../../lib/actions/service-principal-actions', () => ({
  listServicePrincipalRowsAction: m.list,
  getServicePrincipalUsage: m.usage,
  getServicePrincipalFormOptionsAction: m.options,
  createServicePrincipalAction: m.create,
  updateServicePrincipalAction: m.update,
  setServicePrincipalActiveAction: m.setActive,
  deleteServicePrincipalAction: m.remove,
  setServicePrincipalRolesAction: m.setRoles,
  listServicePrincipalKeysAction: m.keys,
  issueServicePrincipalKeyAction: m.issueKey,
  rotateServicePrincipalKeyAction: m.rotateKey,
  revokeServicePrincipalKeyAction: m.revokeKey,
}));

import { ServicePrincipalsSettingsTab } from '../../../components/service-principals/ServicePrincipalsSettingsTab';
import { McpAgentCreateGate } from '../../../components/service-principals/McpAgentCreateGate';

const FORM_OPTIONS = {
  roles: [
    { role_id: 'role-1', role_name: 'Technician' },
    { role_id: 'role-2', role_name: 'Dispatcher' },
  ],
  rateLimitCeiling: { maxTokens: 120, refillPerMin: 60 },
};

beforeEach(() => {
  Object.values(m).forEach((fn) => (fn as ReturnType<typeof vi.fn>).mockReset());
  m.hasFeature.mockReturnValue(true);
  m.options.mockResolvedValue(FORM_OPTIONS);
  m.usage.mockResolvedValue({ limit: 5, used: 2, remaining: 3 });
  m.list.mockResolvedValue([
    makeRow(),
    makeRow({ user_id: 'user-2', kind: 'mcp_agent', name: 'Support agent', role_names: [] }),
  ]);
  m.keys.mockResolvedValue([{
    api_key_id: 'key-1',
    description: 'CI key',
    active: true,
    expires_at: null,
    last_used_at: null,
    created_at: '2026-10-01T00:00:00.000Z',
  }]);
  m.create.mockResolvedValue({});
});
afterEach(cleanup);

describe('T030 service principals tab', () => {
  it('lists principals by display name with kind badges and the "x of y" header', async () => {
    render(<ServicePrincipalsSettingsTab />);
    expect(await screen.findByText('Billing sync')).toBeTruthy();
    expect(screen.getByText('Support agent')).toBeTruthy();
    expect(screen.getByText('MCP agent')).toBeTruthy();
    expect(screen.getAllByText('Ada Admin').length).toBeGreaterThan(0);
    expect(screen.getByTestId('service-principal-usage').textContent).toBe('2 of 5 service principals');
    // never a raw id
    expect(document.body.textContent).not.toContain('user-1');
    expect(document.body.textContent).not.toContain('creator-1');
    expect((screen.getByRole('button', { name: 'New service principal' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('renders the Act-as column for both values and explains seat use and act-as behavior', async () => {
    m.list.mockResolvedValue([
      makeRow({ allow_act_as: false }),
      makeRow({ user_id: 'user-2', name: 'Support agent', kind: 'mcp_agent', allow_act_as: true }),
    ]);
    render(<ServicePrincipalsSettingsTab />);

    expect(await screen.findByText('Support agent')).toBeTruthy();
    expect(screen.getByText('Act-as')).toBeTruthy();
    expect(screen.getByText('Yes')).toBeTruthy();
    expect(screen.getByText('No')).toBeTruthy();
    expect(screen.getByText('Service principals do not consume seats.')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'New service principal' }));
    expect(await screen.findByText(/When enabled, requests can act as an active internal user/)).toBeTruthy();
  });

  it('disables New at the limit and says why', async () => {
    m.usage.mockResolvedValue({ limit: 2, used: 2, remaining: 0 });
    render(<ServicePrincipalsSettingsTab />);
    await screen.findByText('Billing sync');
    await waitFor(() =>
      expect((screen.getByRole('button', { name: 'New service principal' }) as HTMLButtonElement).disabled).toBe(true),
    );
    expect(screen.getByTestId('service-principal-limit-reached').textContent).toContain('limit of 2');
  });

  it('create dialog saves name, roles and act-as', async () => {
    render(<ServicePrincipalsSettingsTab />);
    await screen.findByText('Billing sync');
    fireEvent.click(screen.getByRole('button', { name: 'New service principal' }));
    await screen.findByRole('dialog');
    const name = document.getElementById('service-principal-name') as HTMLInputElement;
    fireEvent.change(name, { target: { value: 'Reporting bot' } });
    fireEvent.click(screen.getByLabelText('Dispatcher'));
    fireEvent.click(document.getElementById('service-principal-allow-act-as') as HTMLElement);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(m.create).toHaveBeenCalledTimes(1));
    expect(m.create).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'api', name: 'Reporting bot', roleIds: ['role-2'], allowActAs: true }),
    );
  });
});

describe('T036 below Pro', () => {
  beforeEach(() => m.hasFeature.mockReturnValue(false));

  it('shows the standard upgrade notice when there are no existing principals', async () => {
    m.list.mockResolvedValue([]);
    render(<ServicePrincipalsSettingsTab />);
    expect(await screen.findByText(/requires Pro/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'New service principal' })).toBeNull();
    expect(screen.getByRole('link', { name: 'View Plans' }).getAttribute('href')).toBe('/msp/account');
  });

  it('keeps blocked principals visible with only deactivate and delete actions', async () => {
    render(<ServicePrincipalsSettingsTab />);
    await screen.findByText('Billing sync');
    expect(screen.getByTestId('service-principal-blocked-notice').textContent).toMatch(/access.*blocked immediately below Pro/i);
    expect(screen.getByText('Service principals requires Pro')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'View Plans' }).getAttribute('href')).toBe('/msp/account');
    expect(screen.queryByRole('button', { name: 'New service principal' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Keys' })).toBeNull();
    expect(screen.queryByRole('switch')).toBeNull();
    expect(screen.getAllByRole('button', { name: 'Deactivate' })).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: 'Delete' })).toHaveLength(2);

    fireEvent.click(screen.getAllByRole('button', { name: 'Deactivate' })[0]);
    await waitFor(() => expect(m.setActive).toHaveBeenCalledWith('user-1', false));
  });

  it('shows the standard upgrade notice and working CTA while existing MCP content stays available', async () => {
    render(
      <>
        <p>Existing agent list</p>
        <McpAgentCreateGate>
          {({ disabled }) => <button disabled={disabled}>Add agent</button>}
        </McpAgentCreateGate>
      </>,
    );
    expect(await screen.findByText('Existing agent list')).toBeTruthy();
    expect(await screen.findByText('Service principals requires Pro')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'View Plans' }).getAttribute('href')).toBe('/msp/account');
    expect(screen.queryByRole('button', { name: 'Add agent' })).toBeNull();
    const sharedUsage = await screen.findByTestId('mcp-shared-limit');
    expect(sharedUsage.textContent).toContain('2 of 5');
    expect(sharedUsage.textContent).toContain('active records are blocked by the plan');
    expect(screen.getByTestId('mcp-service-principals-blocked-notice').textContent).toMatch(/access.*blocked immediately below Pro/i);
    expect(m.usage).toHaveBeenCalled();
  });

});

describe('T032 MCP agent create gate on Pro (shared limit)', () => {
  it('refreshes shared usage when the caller reports an agent mutation', async () => {
    m.hasFeature.mockReturnValue(true);
    const { rerender } = render(
      <McpAgentCreateGate refreshKey={0}>
        {({ disabled }) => <button disabled={disabled}>Add agent</button>}
      </McpAgentCreateGate>,
    );
    await screen.findByTestId('mcp-shared-limit');
    expect(m.usage).toHaveBeenCalledTimes(1);

    rerender(
      <McpAgentCreateGate refreshKey={1}>
        {({ disabled }) => <button disabled={disabled}>Add agent</button>}
      </McpAgentCreateGate>,
    );
    await waitFor(() => expect(m.usage).toHaveBeenCalledTimes(2));
  });

  it('allows creation below capacity', async () => {
    m.hasFeature.mockReturnValue(true);
    m.usage.mockResolvedValue({ limit: 3, used: 2, remaining: 1 });
    render(
      <McpAgentCreateGate>
        {({ disabled }) => <button disabled={disabled}>Add agent</button>}
      </McpAgentCreateGate>,
    );
    expect(await screen.findByTestId('mcp-shared-limit')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Add agent' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('shows the shared limit and disables Add agent at the limit', async () => {
    m.hasFeature.mockReturnValue(true);
    m.usage.mockResolvedValue({ limit: 3, used: 3, remaining: 0 });
    render(
      <McpAgentCreateGate>
        {({ disabled }) => <button disabled={disabled}>Add agent</button>}
      </McpAgentCreateGate>,
    );
    const shared = await screen.findByTestId('mcp-shared-limit');
    expect(within(shared).getByText(/3 of 3 in use/)).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Add agent' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId('mcp-limit-reached')).toBeTruthy();
  });
});

describe('T036 tier changes', () => {
  it('restores operational actions after returning to Pro without changing retained rows', async () => {
    m.hasFeature.mockReturnValue(false);
    const { rerender } = render(<ServicePrincipalsSettingsTab />);
    expect(await screen.findByText('Billing sync')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Keys' })).toBeNull();

    m.hasFeature.mockReturnValue(true);
    rerender(<ServicePrincipalsSettingsTab />);
    expect((await screen.findAllByRole('button', { name: 'Edit' })).length).toBe(2);
    expect(screen.getAllByRole('button', { name: 'Keys' })).toHaveLength(2);
    expect(screen.getByTestId('service-principal-usage').textContent).toBe('2 of 5 service principals');
    expect(screen.getByText('Billing sync')).toBeTruthy();
  });

  it('closes a create dialog on downgrade and does not reopen it or save after upgrade', async () => {
    const { rerender } = render(<ServicePrincipalsSettingsTab />);
    await screen.findByText('Billing sync');
    fireEvent.click(screen.getByRole('button', { name: 'New service principal' }));
    expect(await screen.findByRole('dialog')).toBeTruthy();

    m.hasFeature.mockReturnValue(false);
    rerender(<ServicePrincipalsSettingsTab />);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByTestId('service-principal-blocked-notice')).toBeTruthy();

    m.hasFeature.mockReturnValue(true);
    rerender(<ServicePrincipalsSettingsTab />);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(m.create).not.toHaveBeenCalled();
  });

  it('closes an edit dialog on downgrade and cannot submit it after upgrade', async () => {
    const { rerender } = render(<ServicePrincipalsSettingsTab />);
    await screen.findByText('Billing sync');
    fireEvent.click(screen.getAllByRole('button', { name: 'Edit' })[0]);
    expect(await screen.findByRole('dialog')).toBeTruthy();

    m.hasFeature.mockReturnValue(false);
    rerender(<ServicePrincipalsSettingsTab />);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    m.hasFeature.mockReturnValue(true);
    rerender(<ServicePrincipalsSettingsTab />);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
    expect(m.update).not.toHaveBeenCalled();
    expect(m.setRoles).not.toHaveBeenCalled();
  });

  it('unmounts key management and nested confirmations on downgrade and does not restore them after upgrade', async () => {
    const { rerender } = render(<ServicePrincipalsSettingsTab />);
    await screen.findByText('Billing sync');
    fireEvent.click(screen.getAllByRole('button', { name: 'Keys' })[0]);
    expect(await screen.findByRole('dialog')).toBeTruthy();
    await screen.findByText('CI key');
    fireEvent.click(screen.getByRole('button', { name: 'Revoke' }));
    expect(await screen.findByText('Revoke API key?')).toBeTruthy();

    m.hasFeature.mockReturnValue(false);
    rerender(<ServicePrincipalsSettingsTab />);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(m.issueKey).not.toHaveBeenCalled();
    expect(m.rotateKey).not.toHaveBeenCalled();
    expect(m.revokeKey).not.toHaveBeenCalled();

    m.hasFeature.mockReturnValue(true);
    rerender(<ServicePrincipalsSettingsTab />);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Create key' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Rotate' })).toBeNull();
    expect(m.issueKey).not.toHaveBeenCalled();
    expect(m.rotateKey).not.toHaveBeenCalled();
    expect(m.revokeKey).not.toHaveBeenCalled();
  });
});
