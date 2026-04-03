/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import QuickAddContact from '../../../../../packages/clients/src/components/contacts/QuickAddContact';

const { addContactMock, createTagsForEntityMock } = vi.hoisted(() => ({
  addContactMock: vi.fn(),
  createTagsForEntityMock: vi.fn().mockResolvedValue([]),
}));

const toastMock = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    refresh: vi.fn(),
    push: vi.fn(),
    replace: vi.fn(),
  }),
}));

vi.mock('@alga-psa/clients/actions', () => ({
  addContact: addContactMock,
  getAllCountries: vi.fn().mockResolvedValue([{ code: 'US', name: 'United States', phone_code: '+1' }]),
  listContactPhoneTypeSuggestions: vi.fn().mockResolvedValue(['Desk Line']),
}));

vi.mock('@alga-psa/ui', () => ({
  useToast: () => ({ toast: toastMock }),
}));

vi.mock('@alga-psa/ui/components/Dialog', () => ({
  Dialog: ({ children, isOpen }: any) => (isOpen ? <div>{children}</div> : null),
  DialogContent: ({ children }: any) => <div>{children}</div>,
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

vi.mock('@alga-psa/ui/components/Switch', () => ({
  Switch: ({ checked, onCheckedChange, ...props }: any) => (
    <input
      {...props}
      type="checkbox"
      checked={checked}
      onChange={(event) => onCheckedChange(event.target.checked)}
    />
  ),
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

vi.mock('@alga-psa/ui/components/ClientPicker', () => ({
  ClientPicker: () => <div data-testid="client-picker" />,
}));

vi.mock('@alga-psa/tags/components', () => ({
  QuickAddTagPicker: () => <div data-testid="quick-add-tag-picker" />,
}));

vi.mock('@alga-psa/tags/actions', () => ({
  createTagsForEntity: createTagsForEntityMock,
}));

afterEach(() => {
  cleanup();
});

describe('QuickAddContact hybrid email and phone payloads', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    addContactMock.mockResolvedValue({
      success: true,
      contact: {
        contact_name_id: 'contact-1',
        full_name: 'Alex Contact',
        email: 'alex@acme.com',
        phone_numbers: [],
        default_phone_number: null,
        default_phone_type: null,
        client_id: null,
        role: null,
        notes: null,
        is_inactive: false,
        created_at: '2026-03-09T12:00:00.000Z',
        updated_at: '2026-03-09T12:00:00.000Z',
      },
    });
  });

  it('T022: creates a contact with labeled primary email data, an additional email row, and normalized phone rows', async () => {
    const user = userEvent.setup();
    const onContactAdded = vi.fn();

    render(
      <QuickAddContact
        isOpen={true}
        onClose={vi.fn()}
        onContactAdded={onContactAdded}
        clients={[]}
      />
    );

    await user.type(document.getElementById('quick-add-contact-name') as HTMLInputElement, 'Alex Contact');
    await user.type(document.getElementById('quick-add-contact-email-primary-email') as HTMLInputElement, 'alex@acme.com');
    await user.click(document.getElementById('quick-add-contact-email-add') as HTMLButtonElement);
    await user.type(document.getElementById('quick-add-contact-email-additional-email-0') as HTMLInputElement, 'billing@acme.com');
    await user.selectOptions(screen.getByLabelText('quick-add-contact-email-additional-type-0'), 'billing');

    await waitFor(() => {
      expect(screen.getAllByLabelText('Phone Number')).toHaveLength(1);
    });

    await user.click(document.getElementById('quick-add-contact-phone-add-phone') as HTMLButtonElement);

    await waitFor(() => {
      expect(screen.getAllByLabelText('Phone Number')).toHaveLength(2);
    });

    const phoneInputs = screen.getAllByLabelText('Phone Number');
    await user.type(phoneInputs[0]!, '+1 555 111 2222');
    await user.type(phoneInputs[1]!, '+1 555 333 4444');

    await user.click(screen.getByRole('button', { name: /add contact/i }));

    await waitFor(() => {
      expect(addContactMock).toHaveBeenCalledTimes(1);
    });

    expect(addContactMock).toHaveBeenCalledWith(expect.objectContaining({
      full_name: 'Alex Contact',
      email: 'alex@acme.com',
      primary_email_canonical_type: 'work',
      primary_email_custom_type: null,
      additional_email_addresses: [
        expect.objectContaining({
          email_address: 'billing@acme.com',
          canonical_type: 'billing',
          custom_type: null,
          display_order: 0,
        }),
      ],
      phone_numbers: [
        expect.objectContaining({
          phone_number: '+1 555 111 2222',
          canonical_type: 'work',
          custom_type: null,
          is_default: true,
          display_order: 0,
        }),
        expect.objectContaining({
          phone_number: '+1 555 333 4444',
          canonical_type: 'work',
          custom_type: null,
          is_default: false,
          display_order: 1,
        }),
      ],
    }));

    await waitFor(() => {
      expect(onContactAdded).toHaveBeenCalledTimes(1);
    });
  });

  it('shows a validation toast when addContact returns a handled duplicate-email error', async () => {
    const user = userEvent.setup();
    addContactMock.mockResolvedValueOnce({
      success: false,
      error: 'EMAIL_EXISTS: A contact with this email address already exists in the system',
    });

    render(
      <QuickAddContact
        isOpen={true}
        onClose={vi.fn()}
        onContactAdded={vi.fn()}
        clients={[]}
      />
    );

    await user.type(document.getElementById('quick-add-contact-name') as HTMLInputElement, 'Dupe Test');
    await user.type(document.getElementById('quick-add-contact-email-primary-email') as HTMLInputElement, 'dupe@example.com');
    await user.click(screen.getByRole('button', { name: /add contact/i }));

    await waitFor(() => {
      expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({
        title: 'Email Already Exists',
        variant: 'destructive',
      }));
    });
  });
});
