/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import QuickAddClient from '../../../../../packages/clients/src/components/clients/QuickAddClient';

const { createClientMock, createClientContactMock } = vi.hoisted(() => ({
  createClientMock: vi.fn(),
  createClientContactMock: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    refresh: vi.fn(),
    push: vi.fn(),
    replace: vi.fn(),
  }),
}));

vi.mock('../../../../../packages/clients/src/lib/usersHelpers', () => ({
  getAllUsersBasicAsync: vi.fn().mockResolvedValue([]),
}));

vi.mock('@alga-psa/clients/actions', () => ({
  createClient: createClientMock,
  createClientLocation: vi.fn().mockResolvedValue({}),
  createClientContact: createClientContactMock,
  getAllCountries: vi.fn().mockResolvedValue([{ code: 'US', name: 'United States', phone_code: '+1' }]),
  listContactPhoneTypeSuggestions: vi.fn().mockResolvedValue(['After Hours']),
}));

vi.mock('@alga-psa/ui/components/Dialog', () => ({
  Dialog: ({ children, isOpen }: any) => (isOpen ? <div>{children}</div> : null),
  DialogContent: ({ children }: any) => <div>{children}</div>,
  DialogTrigger: ({ children }: any) => <div>{children}</div>,
  DialogFooter: ({ children }: any) => <div>{children}</div>,
}));

vi.mock('@alga-psa/ui/components/Button', () => ({
  Button: ({ children, ...props }: any) => <button {...props}>{children}</button>,
}));

vi.mock('@alga-psa/ui/components/Card', () => ({
  Card: ({ children, ...props }: any) => <div {...props}>{children}</div>,
}));

vi.mock('@alga-psa/ui/components/Input', () => ({
  Input: (props: any) => <input {...props} />,
}));

vi.mock('@alga-psa/ui/components/TextArea', () => ({
  TextArea: (props: any) => <textarea {...props} />,
}));

vi.mock('@alga-psa/ui/components/Label', () => ({
  Label: ({ children, ...props }: any) => <label {...props}>{children}</label>,
}));

vi.mock('@alga-psa/ui/components/PhoneInput', () => ({
  PhoneInput: ({ id, label, value, onChange }: any) => (
    <label htmlFor={id}>
      {label}
      <input id={id} aria-label={label} value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  ),
}));

vi.mock('@alga-psa/ui/components/CustomSelect', () => ({
  default: ({ id, value, onValueChange, options }: any) => (
    <select id={id} aria-label={id} value={value} onChange={(event) => onValueChange(event.target.value)}>
      {options.map((option: { value: string; label: string }) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  ),
}));

vi.mock('@alga-psa/ui/components/SearchableSelect', () => ({
  default: ({ id, value, onChange, placeholder }: any) => (
    <input
      id={id}
      aria-label={id}
      placeholder={placeholder}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  ),
}));

vi.mock('@alga-psa/ui/components/UserPicker', () => ({
  default: () => <div data-testid="user-picker" />,
}));

vi.mock('@alga-psa/ui/components/CountryPicker', () => ({
  default: () => <div data-testid="country-picker" />,
}));

vi.mock('../../../../../packages/clients/src/components/clients/ClientCreatedDialog', () => ({
  default: () => <div data-testid="client-created-dialog" />,
}));

vi.mock('@alga-psa/tags/components', () => ({
  QuickAddTagPicker: () => <div data-testid="quick-add-tag-picker" />,
}));

vi.mock('@alga-psa/tags/actions', () => ({
  createTagsForEntity: vi.fn().mockResolvedValue([]),
}));

vi.mock('@alga-psa/ui/lib/errorHandling', () => ({
  handleError: vi.fn(),
}));

vi.mock('react-hot-toast', () => ({
  default: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

afterEach(() => {
  cleanup();
});

describe('QuickAddClient hybrid inline-contact payloads', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createClientMock.mockResolvedValue({
      success: true,
      data: {
        client_id: 'client-1',
        client_name: 'Acme',
        tags: [],
      },
    });
    createClientContactMock.mockResolvedValue({});
  });

  it('T023: creates the inline contact with the hybrid email payload plus the normalized phone collection', async () => {
    const user = userEvent.setup();

    render(
      <QuickAddClient
        open={true}
        onOpenChange={vi.fn()}
        onClientAdded={vi.fn()}
      />
    );

    await user.type(document.getElementById('client-name') as HTMLInputElement, 'Acme');
    await user.type(document.getElementById('contact-name') as HTMLInputElement, 'Alex Contact');
    await user.type(document.getElementById('client-contact-email-primary-email') as HTMLInputElement, 'alex@acme.com');
    await user.click(document.getElementById('client-contact-email-add') as HTMLButtonElement);
    await user.type(document.getElementById('client-contact-email-additional-email-0') as HTMLInputElement, 'billing@acme.com');
    await user.selectOptions(screen.getByLabelText('client-contact-email-additional-type-0'), 'billing');

    await waitFor(() => {
      expect(screen.getAllByLabelText('Phone Number')).toHaveLength(1);
    });

    await user.click(document.getElementById('client-contact-phone-add-phone') as HTMLButtonElement);

    await waitFor(() => {
      expect(screen.getAllByLabelText('Phone Number')).toHaveLength(2);
    });

    const phoneInputs = screen.getAllByLabelText('Phone Number');
    await user.type(phoneInputs[0]!, '+1 555 111 2222');
    await user.type(phoneInputs[1]!, '+1 555 333 4444');
    await user.click(screen.getAllByRole('radio', { name: 'Default' })[1]!);

    await user.click(screen.getByRole('button', { name: /create client/i }));

    await waitFor(() => {
      expect(createClientContactMock).toHaveBeenCalledTimes(1);
    });

    expect(createClientContactMock).toHaveBeenCalledWith(expect.objectContaining({
      clientId: 'client-1',
      fullName: 'Alex Contact',
      email: 'alex@acme.com',
      primaryEmailCanonicalType: 'work',
      primaryEmailCustomType: null,
      additionalEmailAddresses: [
        expect.objectContaining({
          email_address: 'billing@acme.com',
          canonical_type: 'billing',
          custom_type: null,
          display_order: 0,
        }),
      ],
      phoneNumbers: [
        expect.objectContaining({
          phone_number: '+1 555 111 2222',
          canonical_type: 'work',
          custom_type: null,
          is_default: false,
          display_order: 0,
        }),
        expect.objectContaining({
          phone_number: '+1 555 333 4444',
          canonical_type: 'work',
          custom_type: null,
          is_default: true,
          display_order: 1,
        }),
      ],
    }));
  });
});
