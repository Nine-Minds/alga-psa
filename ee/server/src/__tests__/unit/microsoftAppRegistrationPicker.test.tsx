// @vitest-environment jsdom
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  listMicrosoftProfilesMock,
  listMicrosoftConsumerBindingsMock,
  setMicrosoftConsumerBindingMock,
  getMicrosoftIntegrationStatusMock,
} = vi.hoisted(() => ({
  listMicrosoftProfilesMock: vi.fn(),
  listMicrosoftConsumerBindingsMock: vi.fn(),
  setMicrosoftConsumerBindingMock: vi.fn(),
  getMicrosoftIntegrationStatusMock: vi.fn(),
}));

vi.mock('@alga-psa/ui/lib/i18n/client', async () => {
  const actual = await vi.importActual('@alga-psa/ui/lib/i18n/client');
  return actual as Record<string, unknown>;
});

vi.mock('@alga-psa/integrations/actions', () => ({
  listMicrosoftProfiles: listMicrosoftProfilesMock,
  listMicrosoftConsumerBindings: listMicrosoftConsumerBindingsMock,
  setMicrosoftConsumerBinding: setMicrosoftConsumerBindingMock,
  getMicrosoftIntegrationStatus: getMicrosoftIntegrationStatusMock,
}));

// The shared profile form dialog has its own contract suite in
// packages/integrations; the picker only needs its open/onSaved seam.
const dialogPropsSpy = vi.hoisted(() => vi.fn());
vi.mock('@alga-psa/integrations/components/settings/integrations/MicrosoftProfileFormDialog', () => ({
  MicrosoftProfileFormDialog: (props: any) => {
    dialogPropsSpy(props);
    return props.open ? (
      <div id="mock-profile-form-dialog">
        <button
          type="button"
          id="mock-profile-form-save"
          onClick={() =>
            props.onSaved({ profileId: 'profile-new', displayName: 'Created App', clientId: 'client-new' })
          }
        >
          save
        </button>
      </div>
    ) : null;
  },
}));

vi.mock('@alga-psa/ui/components/CustomSelect', () => ({
  default: ({ id, options, value, onValueChange, placeholder }: any) => (
    <select
      data-testid={id}
      value={value ?? ''}
      onChange={(event) => onValueChange(event.target.value)}
    >
      <option value="">{placeholder}</option>
      {options.map((option: any) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  ),
}));

import { MicrosoftAppRegistrationPicker } from '@ee/components/settings/integrations/entra/MicrosoftAppRegistrationPicker';

const capableProfile = {
  profileId: 'profile-entra',
  displayName: 'Partner App',
  clientId: 'client-entra',
  isArchived: false,
  capabilities: ['entra'],
};
const emailOnlyProfile = {
  profileId: 'profile-email',
  displayName: 'Email Only App',
  clientId: 'client-email',
  isArchived: false,
  capabilities: ['email'],
};
const archivedProfile = {
  profileId: 'profile-archived',
  displayName: 'Archived App',
  clientId: 'client-archived',
  isArchived: true,
  capabilities: ['entra'],
};

describe('MicrosoftAppRegistrationPicker', () => {
  beforeEach(() => {
    dialogPropsSpy.mockClear();
    listMicrosoftProfilesMock.mockReset();
    listMicrosoftConsumerBindingsMock.mockReset().mockResolvedValue({ success: true, bindings: [] });
    setMicrosoftConsumerBindingMock.mockReset().mockResolvedValue({ success: true });
    getMicrosoftIntegrationStatusMock.mockReset().mockResolvedValue({
      success: true,
      redirectUris: { entra: 'https://psa.example.com/api/auth/microsoft/entra/callback' },
      scopes: { entra: ['https://graph.microsoft.com/User.Read', 'offline_access'] },
    });
  });

  it('offers only non-archived, entra-capable profiles', async () => {
    listMicrosoftProfilesMock.mockResolvedValue({
      success: true,
      profiles: [capableProfile, emailOnlyProfile, archivedProfile],
    });

    render(<MicrosoftAppRegistrationPicker onBound={vi.fn()} />);

    const select = await screen.findByTestId('entra-app-registration-select');
    const labels = Array.from(select.querySelectorAll('option')).map((option) => option.textContent);
    expect(labels).toContain('Partner App (client-entra)');
    expect(labels.join()).not.toContain('Email Only App');
    expect(labels.join()).not.toContain('Archived App');
  });

  it('selecting a profile writes the entra binding and reports it bound', async () => {
    const onBound = vi.fn();
    listMicrosoftProfilesMock.mockResolvedValue({ success: true, profiles: [capableProfile] });

    render(<MicrosoftAppRegistrationPicker onBound={onBound} />);

    fireEvent.change(await screen.findByTestId('entra-app-registration-select'), {
      target: { value: 'profile-entra' },
    });

    await waitFor(() => {
      expect(setMicrosoftConsumerBindingMock).toHaveBeenCalledWith({
        consumerType: 'entra',
        profileId: 'profile-entra',
      });
    });
    expect(onBound).toHaveBeenCalledWith({ id: 'profile-entra', name: 'Partner App' });
  });

  it('surfaces a binding failure instead of reporting the profile bound', async () => {
    const onBound = vi.fn();
    listMicrosoftProfilesMock.mockResolvedValue({ success: true, profiles: [capableProfile] });
    setMicrosoftConsumerBindingMock.mockResolvedValue({ success: false, error: 'nope' });

    render(<MicrosoftAppRegistrationPicker onBound={onBound} />);

    fireEvent.change(await screen.findByTestId('entra-app-registration-select'), {
      target: { value: 'profile-entra' },
    });

    await waitFor(() => {
      expect(document.getElementById('entra-app-registration-error')?.textContent).toBe('nope');
    });
    expect(onBound).toHaveBeenCalledWith(null);
  });

  it('reports an existing entra binding as bound on load', async () => {
    const onBound = vi.fn();
    listMicrosoftProfilesMock.mockResolvedValue({ success: true, profiles: [capableProfile] });
    listMicrosoftConsumerBindingsMock.mockResolvedValue({
      success: true,
      bindings: [{ consumerType: 'entra', profileId: 'profile-entra', profileDisplayName: 'Partner App' }],
    });

    render(<MicrosoftAppRegistrationPicker onBound={onBound} />);

    await waitFor(() => {
      expect(onBound).toHaveBeenCalledWith({ id: 'profile-entra', name: 'Partner App' });
    });
  });

  it('with no capable profile, inline creation opens the shared form and auto-binds the created profile', async () => {
    const onBound = vi.fn();
    listMicrosoftProfilesMock.mockResolvedValue({ success: true, profiles: [emailOnlyProfile] });

    render(<MicrosoftAppRegistrationPicker onBound={onBound} />);

    const addButton = await screen.findByRole('button', { name: 'Add app registration' });
    expect(document.getElementById('mock-profile-form-dialog')).toBeNull();

    fireEvent.click(addButton);
    await waitFor(() => {
      expect(document.getElementById('mock-profile-form-dialog')).not.toBeNull();
    });

    // The shared form is opened in create mode pre-scoped to Entra, with the
    // metadata-derived guidance the operator copies into Azure.
    const lastProps = dialogPropsSpy.mock.calls.at(-1)?.[0];
    expect(lastProps.mode).toBe('create');
    expect(lastProps.initialCapabilities).toEqual(['entra']);
    expect(lastProps.guidance).toEqual([
      expect.objectContaining({ value: 'https://psa.example.com/api/auth/microsoft/entra/callback' }),
      expect.objectContaining({ value: 'https://graph.microsoft.com/User.Read, offline_access' }),
    ]);

    fireEvent.click(screen.getByRole('button', { name: 'save' }));

    await waitFor(() => {
      expect(setMicrosoftConsumerBindingMock).toHaveBeenCalledWith({
        consumerType: 'entra',
        profileId: 'profile-new',
      });
    });
    expect(onBound).toHaveBeenCalledWith({ id: 'profile-new', name: 'Created App' });
  });
});
