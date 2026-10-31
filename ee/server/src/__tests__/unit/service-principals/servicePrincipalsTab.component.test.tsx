// @vitest-environment jsdom
/**
 * T030 (tab list, "x of y", New disabled at limit, create dialog saves roles + act-as) and
 * T032 (MCP shared limit) and T036 (below Pro: upgrade notice, grandfathered rows with deactivate/delete only, MCP create gate).
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
}));

vi.mock('server/src/context/TierContext', () => ({
  useTier: () => ({ hasFeature: m.hasFeature, isLoading: false }),
}));
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string } & Record<string, unknown>) =>
      interpolate(options?.defaultValue ?? key, options),
  }),
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
  issueServicePrincipalKeyAction: vi.fn(),
  rotateServicePrincipalKeyAction: vi.fn(),
  revokeServicePrincipalKeyAction: vi.fn(),
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
  Object.values(m).forEach((fn) => fn.mockReset());
  m.hasFeature.mockReturnValue(true);
  m.options.mockResolvedValue(FORM_OPTIONS);
  m.usage.mockResolvedValue({ limit: 5, used: 2, remaining: 3 });
  m.list.mockResolvedValue([
    makeRow(),
    makeRow({ user_id: 'user-2', kind: 'mcp_agent', name: 'Support agent', role_names: [] }),
  ]);
  m.create.mockResolvedValue({});
});
afterEach(cleanup);

describe('T030 service principals tab', () => {
  it('lists principals by display name with kind badges and the "x of y" header', async () => {
    render(<ServicePrincipalsSettingsTab />);
    expect(await screen.findByText('Billing sync')).toBeTruthy();
    expect(screen.getByText('Support agent')).toBeTruthy();
    expect(screen.getByText('MCP agent')).toBeTruthy();
    expect(screen.getByText('Ada Admin', { selector: 'td, td *' })).toBeTruthy();
    expect(screen.getByTestId('service-principal-usage').textContent).toBe('2 of 5 service principals');
    // never a raw id
    expect(document.body.textContent).not.toContain('user-1');
    expect(document.body.textContent).not.toContain('creator-1');
    expect((screen.getByRole('button', { name: 'New service principal' }) as HTMLButtonElement).disabled).toBe(false);
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
    const name = await screen.findByLabelText('Name');
    fireEvent.change(name, { target: { value: 'Reporting bot' } });
    fireEvent.click(screen.getByLabelText('Dispatcher'));
    fireEvent.click(screen.getByRole('switch', { name: 'Allow acting on behalf of a user' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(m.create).toHaveBeenCalledTimes(1));
    expect(m.create).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'api', name: 'Reporting bot', roleIds: ['role-2'], allowActAs: true }),
    );
  });
});

describe('T036 below Pro', () => {
  beforeEach(() => m.hasFeature.mockReturnValue(false));

  it('shows the upgrade notice when nothing is grandfathered', async () => {
    m.list.mockResolvedValue([]);
    render(<ServicePrincipalsSettingsTab />);
    expect(await screen.findByText(/requires Pro/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'New service principal' })).toBeNull();
  });

  it('lists grandfathered principals with only deactivate and delete', async () => {
    render(<ServicePrincipalsSettingsTab />);
    await screen.findByText('Billing sync');
    expect(screen.getByTestId('service-principal-grandfathered-notice')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'New service principal' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Keys' })).toBeNull();
    expect(screen.getAllByRole('button', { name: 'Deactivate' })).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: 'Delete' })).toHaveLength(2);

    fireEvent.click(screen.getAllByRole('button', { name: 'Deactivate' })[0]);
    await waitFor(() => expect(m.setActive).toHaveBeenCalledWith('user-1', false));
  });

  it('MCP agent create is disabled with the Pro explanation', async () => {
    render(
      <McpAgentCreateGate>
        {({ disabled }) => <button disabled={disabled}>Add agent</button>}
      </McpAgentCreateGate>,
    );
    expect(await screen.findByTestId('mcp-requires-pro')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Add agent' }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('T032 MCP agent create gate on Pro (shared limit)', () => {
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
