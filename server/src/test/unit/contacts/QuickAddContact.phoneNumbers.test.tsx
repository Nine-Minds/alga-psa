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

vi.mock('@alga-psa/clients/actions', () => ({
  addContact: addContactMock,
  getAllCountries: vi.fn().mockResolvedValue([{ code: 'US', name: 'United States', phone_code: '+1' }]),
  listContactPhoneTypeSuggestions: vi.fn().mockResolvedValue(['Desk Line']),
}));

vi.mock('@alga-psa/ui', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock('@alga-psa/ui/components/Dialog', () => ({
  Dialog: ({ children, isOpen }: any) => (isOpen ? <div>{children}</div> : null),
  DialogContent: ({ children }: any) => <div>{children}</div>,
  DialogFooter: ({ children }: any) => <div>{children}</div>,
}));

vi.mock('@alga-psa/ui/components/Button', () => ({
  Button: ({ children, ...props }: any) => <button {...props}>{children}</button>,
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

describe('QuickAddContact normalized phone numbers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    addContactMock.mockResolvedValue({
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
    });
  });

  it('T020: creates a contact with one default canonical phone and one additional phone row', async () => {
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
    await user.type(document.getElementById('quick-add-contact-email') as HTMLInputElement, 'alex@acme.com');

    await user.click(document.getElementById('quick-add-contact-phone-add-phone') as HTMLButtonElement);
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
      phone_numbers: [
        expect.objectContaining({
          phone_number: '+15551112222',
          canonical_type: 'work',
          custom_type: null,
          is_default: true,
          display_order: 0,
        }),
        expect.objectContaining({
          phone_number: '+15553334444',
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
});
