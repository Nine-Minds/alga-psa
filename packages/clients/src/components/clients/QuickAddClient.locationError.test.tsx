/* @vitest-environment jsdom */

import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type ChildrenProps = { children?: React.ReactNode };
type ButtonProps = ChildrenProps & {
  id?: string;
  onClick?: React.MouseEventHandler<HTMLButtonElement>;
  type?: 'button' | 'submit' | 'reset';
  disabled?: boolean;
};
type DialogProps = ChildrenProps & { isOpen: boolean; footer?: React.ReactNode };

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  createClientLocation: vi.fn(),
  createClientContact: vi.fn(),
  createTagsForEntity: vi.fn(),
  getAllUsersBasicAsync: vi.fn(),
  getAllCountries: vi.fn(),
  getTenantDefaultCountry: vi.fn(),
  listContactPhoneTypeSuggestions: vi.fn(),
  handleError: vi.fn(),
  push: vi.fn(),
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({ t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key }),
}));
// Keep the real action-error guards; only handleError is observed.
vi.mock('@alga-psa/ui/lib/errorHandling', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@alga-psa/ui/lib/errorHandling')>();
  return { ...actual, handleError: mocks.handleError };
});
vi.mock('react-hot-toast', () => {
  const toast = Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() });
  return { default: toast, toast };
});
vi.mock('@alga-psa/clients/actions/clientActions', () => ({ createClient: mocks.createClient }));
vi.mock('@alga-psa/clients/actions/clientLocationActions', () => ({ createClientLocation: mocks.createClientLocation }));
vi.mock('@alga-psa/clients/actions/countryActions', () => ({
  getAllCountries: mocks.getAllCountries,
  getTenantDefaultCountry: mocks.getTenantDefaultCountry,
}));
vi.mock('@alga-psa/clients/actions/contact-actions/contactActions', () => ({
  createClientContact: mocks.createClientContact,
  listContactPhoneTypeSuggestions: mocks.listContactPhoneTypeSuggestions,
}));
vi.mock('../../lib/usersHelpers', () => ({ getAllUsersBasicAsync: mocks.getAllUsersBasicAsync }));
vi.mock('@alga-psa/user-composition/actions/avatarActions', () => ({ getUserAvatarUrlsBatchAction: vi.fn() }));
vi.mock('@alga-psa/tags/actions/tagActions', () => ({ createTagsForEntity: mocks.createTagsForEntity }));
vi.mock('@alga-psa/tags/components/QuickAddTagPicker', () => ({ QuickAddTagPicker: () => null }));
vi.mock('../contacts/ContactPhoneNumbersEditor', () => ({
  default: () => null,
  compactContactPhoneNumbers: (rows: unknown[]) => rows ?? [],
  validateContactPhoneNumbers: () => [],
}));
vi.mock('../contacts/ContactEmailAddressesEditor', () => ({
  default: () => null,
  compactContactEmailAddresses: (data: { email?: string | null }) => ({
    email: data.email ?? '',
    primary_email_canonical_type: 'work',
    primary_email_custom_type: null,
    additional_email_addresses: [],
  }),
  validateContactEmailAddresses: () => [],
}));
vi.mock('@alga-psa/ui/components/Dialog', () => ({
  Dialog: ({ isOpen, children, footer }: DialogProps) => (isOpen ? <div>{children}{footer}</div> : null),
  DialogContent: ({ children }: ChildrenProps) => <>{children}</>,
  DialogTrigger: ({ children }: ChildrenProps) => <>{children}</>,
}));
vi.mock('@alga-psa/ui/components/Button', () => ({
  Button: ({ id, children, onClick, type, disabled }: ButtonProps) => (
    <button id={id} onClick={onClick} type={type} disabled={disabled}>{children}</button>
  ),
}));
vi.mock('@alga-psa/ui/components/Input', () => ({
  Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
}));
vi.mock('@alga-psa/ui/components/TextArea', () => ({
  TextArea: (props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) => <textarea {...props} />,
}));
vi.mock('@alga-psa/ui/components/Label', () => ({
  Label: ({ children, htmlFor }: ChildrenProps & { htmlFor?: string }) => <label htmlFor={htmlFor}>{children}</label>,
}));
vi.mock('@alga-psa/ui/components/Alert', () => ({
  Alert: ({ children }: ChildrenProps) => <div>{children}</div>,
  AlertDescription: ({ children }: ChildrenProps) => <div>{children}</div>,
}));
vi.mock('@alga-psa/ui/components/CustomSelect', () => ({ default: () => null }));
vi.mock('@alga-psa/ui/components/UserPicker', () => ({ default: () => null }));
vi.mock('@alga-psa/ui/components/CountryPicker', () => ({ default: () => null }));
vi.mock('@alga-psa/ui/components/PhoneInput', () => ({ PhoneInput: () => null }));
vi.mock('@alga-psa/ui/components/FieldWarnings', () => ({ FieldWarnings: () => null }));

import QuickAddClient from './QuickAddClient';

const newClient = { client_id: 'client-1', client_name: 'Acme Inc', tags: [] };

beforeEach(() => {
  mocks.createClient.mockResolvedValue({ success: true, data: newClient });
  mocks.createClientContact.mockResolvedValue(undefined);
  mocks.createTagsForEntity.mockResolvedValue([]);
  mocks.getAllUsersBasicAsync.mockResolvedValue([]);
  mocks.getAllCountries.mockResolvedValue([{ code: 'US', name: 'United States', phone_code: '+1' }]);
  mocks.getTenantDefaultCountry.mockResolvedValue(null);
  mocks.listContactPhoneTypeSuggestions.mockResolvedValue([]);
});

afterEach(() => {
  vi.clearAllMocks();
});

async function submitWithLocation() {
  const onClientAdded = vi.fn();
  const onOpenChange = vi.fn();
  const { container } = render(
    <QuickAddClient open onOpenChange={onOpenChange} onClientAdded={onClientAdded} />
  );

  await waitFor(() => expect(mocks.getAllCountries).toHaveBeenCalled());

  fireEvent.change(container.querySelector('#client-name')!, { target: { value: 'Acme Inc' } });
  fireEvent.click(container.querySelector('#toggle-location-section')!);
  fireEvent.change(container.querySelector('#address-line-1')!, { target: { value: '123 Main Street' } });
  fireEvent.click(container.querySelector('#create-client-btn')!);

  await waitFor(() => expect(mocks.createClientLocation).toHaveBeenCalled());
  await waitFor(() => expect(onClientAdded).toHaveBeenCalled());

  return { onClientAdded, onOpenChange };
}

describe('QuickAddClient location creation failures', () => {
  it('surfaces an action error object returned by createClientLocation', async () => {
    const locationError = { actionError: 'Invalid location data' };
    mocks.createClientLocation.mockResolvedValue(locationError);

    const { onClientAdded } = await submitWithLocation();

    expect(mocks.handleError).toHaveBeenCalledWith(locationError, 'Client created but failed to add location.');
    // The client itself was created, so the dialog still reports success.
    expect(onClientAdded).toHaveBeenCalledWith(expect.objectContaining({ client_id: 'client-1' }));
  });

  it('stays quiet when createClientLocation returns a location', async () => {
    mocks.createClientLocation.mockResolvedValue({ location_id: 'location-1', client_id: 'client-1' });

    await submitWithLocation();

    expect(mocks.handleError).not.toHaveBeenCalled();
  });
});
