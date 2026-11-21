// @vitest-environment jsdom
//
// Rule D6 governs inputs, not the statement of which profile bills. A client
// with one profile sees the default named as text (never an empty slot); a
// client with several gets the picker with the default named.

import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';

const hookState = vi.hoisted(() => ({
  value: {
    profiles: [] as Array<{ billing_profile_id: string; name: string; is_default: boolean }>,
    isSegmented: false,
    defaultProfile: null as { billing_profile_id: string; name: string } | null,
    isLoading: false,
    error: null as unknown,
  },
}));

vi.mock('@alga-psa/ui/hooks/useClientBillingProfiles', () => ({
  useClientBillingProfiles: () => hookState.value,
}));
vi.mock('@alga-psa/billing/actions/billingProfileActions', () => ({
  getClientBillingProfilesForBilling: vi.fn(),
}));
vi.mock('@alga-psa/ui/components/BillingProfilePicker', () => ({
  BillingProfilePicker: ({ unassignedLabel }: { unassignedLabel: string }) => (
    <div data-testid="profile-picker">{unassignedLabel}</div>
  ),
}));
vi.mock('@alga-psa/ui/components/Label', () => ({
  Label: ({ children }: { children: React.ReactNode }) => <label>{children}</label>,
}));
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      let value = String(options?.defaultValue ?? key);
      for (const [name, replacement] of Object.entries(options ?? {})) {
        if (name !== 'defaultValue') value = value.replaceAll(`{{${name}}}`, String(replacement));
      }
      return value;
    },
  }),
}));

const { AssignmentBillingProfileField } = await import(
  '../src/components/billing-dashboard/contracts/AssignmentBillingProfileField'
);

const acme = { billing_profile_id: 'p1', name: 'Acme Corp', is_default: true };
const north = { billing_profile_id: 'p2', name: 'North Plant', is_default: false };

const renderField = (props: Partial<React.ComponentProps<typeof AssignmentBillingProfileField>> = {}) =>
  render(
    <AssignmentBillingProfileField
      clientContractId="cc1"
      clientId="client-1"
      billingProfileId={null}
      billingProfileName={null}
      isEditing={false}
      onChange={() => {}}
      {...props}
    />,
  );
const text = () => screen.getByTestId('assignment-billing-profile-text-cc1');

describe('AssignmentBillingProfileField', () => {
  afterEach(() => cleanup());

  it('names the default as text for a one-profile client, read-only and editing', () => {
    hookState.value = { profiles: [acme], isSegmented: false, defaultProfile: acme, isLoading: false, error: null };
    renderField();
    expect(text()).toHaveTextContent('Use Acme Corp (client default)');
    cleanup();
    renderField({ isEditing: true });
    expect(text()).toHaveTextContent('Use Acme Corp (client default)');
    expect(screen.queryByTestId('profile-picker')).toBeNull();
  });

  it('shows the assigned profile name read-only', () => {
    hookState.value = { profiles: [acme, north], isSegmented: true, defaultProfile: acme, isLoading: false, error: null };
    renderField({ billingProfileId: 'p2' });
    expect(text()).toHaveTextContent('North Plant');
  });

  it('keeps naming an assigned profile the active-only list no longer contains', () => {
    hookState.value = { profiles: [acme], isSegmented: false, defaultProfile: acme, isLoading: false, error: null };
    renderField({ billingProfileId: 'p-retired', billingProfileName: 'Retired Plant' });
    expect(text()).toHaveTextContent('Retired Plant');
  });

  it('offers the picker with the named default only for several profiles while editing', () => {
    hookState.value = { profiles: [acme, north], isSegmented: true, defaultProfile: acme, isLoading: false, error: null };
    renderField({ isEditing: true });
    expect(screen.getByTestId('profile-picker')).toHaveTextContent('Use Acme Corp (client default)');
    cleanup();
    renderField({ isEditing: false });
    expect(screen.queryByTestId('profile-picker')).toBeNull();
    expect(text()).toHaveTextContent('Use Acme Corp (client default)');
  });

  it('says allocation is pending when profiles cannot be loaded', () => {
    hookState.value = { profiles: [], isSegmented: false, defaultProfile: null, isLoading: false, error: new Error('boom') };
    renderField();
    expect(text()).toHaveTextContent('No profile — allocation pending');
  });
});
