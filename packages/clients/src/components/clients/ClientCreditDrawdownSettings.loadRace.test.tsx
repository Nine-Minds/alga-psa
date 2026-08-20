/* @vitest-environment jsdom */

/**
 * Stale-initial-state race regression (task 29.8.17): before the async
 * settings/resolved-policy loads settle, the panel used to render "Use
 * Default Settings" checked and interactive with fallback values for EVERY
 * client. Clicking in that window invoked the go-custom write seeded from a
 * hardcoded policy (auto-apply on / expiration_first / all types),
 * overwriting the client's persisted custom draw-down row — reproduced live
 * against a client persisted at false/newest_first/all.
 *
 * The fix renders nothing interactive until the loads settle (loading and
 * error states are inert), guards every write handler on the settled state,
 * and seeds go-custom ONLY from the loaded resolved policy.
 */

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const updateClientContractLineSettingsAsync = vi.fn(async () => ({ success: true }));
const getClientContractLineSettingsAsync = vi.fn();
const getServiceTypesForSelectionAsync = vi.fn();
const getResolvedCreditDrawdownPolicyAsync = vi.fn();

vi.mock('../../lib/billingHelpers', () => ({
  getClientContractLineSettingsAsync: (...args: unknown[]) => getClientContractLineSettingsAsync(...(args as [])),
  getServiceTypesForSelectionAsync: (...args: unknown[]) => getServiceTypesForSelectionAsync(...(args as [])),
  getResolvedCreditDrawdownPolicyAsync: (...args: unknown[]) => getResolvedCreditDrawdownPolicyAsync(...(args as [])),
  updateClientContractLineSettingsAsync: (...args: unknown[]) => updateClientContractLineSettingsAsync(...(args as [])),
}));

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({
    t: (_key: string, opts?: { defaultValue?: string }) => opts?.defaultValue ?? _key,
  }),
}));

vi.mock('@alga-psa/ui/lib/errorHandling', () => ({
  handleError: vi.fn(),
  isActionPermissionError: (value: unknown) =>
    typeof value === 'object' && value !== null && 'permissionError' in value,
}));

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('@radix-ui/themes', () => ({
  Text: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@alga-psa/ui/components/Switch', () => ({
  Switch: ({ id, checked, onCheckedChange, disabled }: any) => (
    <input
      type="checkbox"
      role="switch"
      data-testid={id}
      id={id}
      checked={!!checked}
      disabled={!!disabled}
      onChange={(event: React.ChangeEvent<HTMLInputElement>) => onCheckedChange?.(event.target.checked)}
    />
  ),
}));

vi.mock('@alga-psa/ui/components/Label', () => ({
  Label: ({ htmlFor, children }: any) => <label htmlFor={htmlFor}>{children}</label>,
}));

vi.mock('@alga-psa/ui/components/Checkbox', () => ({
  Checkbox: ({ id, label, checked, onChange }: any) => (
    <label>
      <input type="checkbox" data-testid={id} id={id} checked={!!checked} onChange={onChange} />
      {label}
    </label>
  ),
}));

vi.mock('@alga-psa/ui/components/CustomSelect', () => ({
  default: ({ id, value, onValueChange, disabled, options }: any) => (
    <select
      data-testid={id}
      id={id}
      value={value ?? ''}
      disabled={!!disabled}
      onChange={(event: React.ChangeEvent<HTMLSelectElement>) => onValueChange?.(event.target.value)}
    >
      {(options ?? []).map((option: { value: string; label: string }) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  ),
}));

import ClientCreditDrawdownSettings from './ClientCreditDrawdownSettings';

const CUSTOM_SETTINGS = {
  creditAutoApplyEnabled: false,
  creditApplicationOrder: 'newest_first' as const,
  creditServiceTypeRestrictionMode: 'all' as const,
  creditEligibleServiceTypeIds: null,
};

const TENANT_POLICY = {
  autoApplyEnabled: true,
  applicationOrder: 'expiration_first' as const,
  eligibleServiceTypeIds: null,
  serviceTypeRestrictionMode: 'all' as const,
};

afterEach(() => {
  vi.clearAllMocks();
});

describe('ClientCreditDrawdownSettings initial-load race', () => {
  it('renders nothing interactive and writes nothing before the loads settle', async () => {
    const settingsLoad = deferred<typeof CUSTOM_SETTINGS>();
    const policyLoad = deferred<typeof TENANT_POLICY>();
    const typesLoad = deferred<never[]>();
    getClientContractLineSettingsAsync.mockReturnValue(settingsLoad.promise);
    getResolvedCreditDrawdownPolicyAsync.mockReturnValue(policyLoad.promise);
    getServiceTypesForSelectionAsync.mockReturnValue(typesLoad.promise);

    render(<ClientCreditDrawdownSettings clientId="client-1" />);

    // Pre-fix world: the master switch renders checked+enabled while the
    // loads are still in flight. If anything interactive is present, click it
    // the way the live repro did — the write below must never fire.
    const preLoadSwitch = screen.queryByTestId('use-default-credit-drawdown');
    if (preLoadSwitch) {
      await userEvent.click(preLoadSwitch);
    }
    expect(updateClientContractLineSettingsAsync).not.toHaveBeenCalled();
    expect(screen.getByText('Loading...')).toBeInTheDocument();

    // Loads settle on a client with a persisted custom policy: the controls
    // appear seeded from the LOADED data (custom => Use Default unchecked,
    // auto-apply off, newest_first), never from pre-load fallbacks.
    settingsLoad.resolve({ ...CUSTOM_SETTINGS });
    policyLoad.resolve({ ...TENANT_POLICY });
    typesLoad.resolve([]);

    const loadedSwitch = await screen.findByTestId('use-default-credit-drawdown');
    expect(loadedSwitch).not.toBeChecked();
    expect(screen.getByTestId('client-credit-auto-apply-enabled')).not.toBeChecked();
    expect(screen.getByTestId('client-credit-application-order')).toHaveValue('newest_first');
    expect(updateClientContractLineSettingsAsync).not.toHaveBeenCalled();
  });

  it('stays inert when the load fails instead of exposing writable fallback state', async () => {
    getClientContractLineSettingsAsync.mockRejectedValue(new Error('load failed'));
    getResolvedCreditDrawdownPolicyAsync.mockResolvedValue({ ...TENANT_POLICY });
    getServiceTypesForSelectionAsync.mockResolvedValue([]);

    render(<ClientCreditDrawdownSettings clientId="client-2" />);

    await waitFor(() => {
      expect(screen.getByText('Failed to load settings')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('use-default-credit-drawdown')).toBeNull();
    expect(updateClientContractLineSettingsAsync).not.toHaveBeenCalled();
  });

  it('seeds go-custom from the loaded resolved policy after the loads settle', async () => {
    getClientContractLineSettingsAsync.mockResolvedValue(null);
    getResolvedCreditDrawdownPolicyAsync.mockResolvedValue({
      ...TENANT_POLICY,
      autoApplyEnabled: false,
      applicationOrder: 'newest_first' as const,
    });
    getServiceTypesForSelectionAsync.mockResolvedValue([]);

    render(<ClientCreditDrawdownSettings clientId="client-3" />);

    const masterSwitch = await screen.findByTestId('use-default-credit-drawdown');
    expect(masterSwitch).toBeChecked();

    await userEvent.click(masterSwitch);

    await waitFor(() => {
      expect(updateClientContractLineSettingsAsync).toHaveBeenCalledTimes(1);
    });
    // The seed mirrors the resolved policy exactly — going custom is a no-op
    // on the effective policy, not a reset to hardcoded defaults.
    expect(updateClientContractLineSettingsAsync).toHaveBeenCalledWith('client-3', {
      creditAutoApplyEnabled: false,
      creditApplicationOrder: 'newest_first',
      creditServiceTypeRestrictionMode: 'all',
      creditEligibleServiceTypeIds: null,
    });
  });
});
