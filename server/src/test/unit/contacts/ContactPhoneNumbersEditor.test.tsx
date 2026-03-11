/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ContactPhoneNumberInput } from '@alga-psa/types';
import ContactPhoneNumbersEditor from '@alga-psa/clients/components/contacts/ContactPhoneNumbersEditor';

vi.mock('@alga-psa/ui/components/Button', () => ({
  Button: ({ children, ...props }: any) => <button {...props}>{children}</button>,
}));

vi.mock('@alga-psa/ui/components/Input', () => ({
  Input: (props: any) => <input {...props} />,
}));

vi.mock('@alga-psa/ui/components/Label', () => ({
  Label: ({ children, ...props }: any) => <label {...props}>{children}</label>,
}));

vi.mock('@alga-psa/ui/components/PhoneInput', () => ({
  PhoneInput: ({ id, label, value, onChange, onBlur }: any) => (
    <label htmlFor={id}>
      {label}
      <input
        id={id}
        aria-label={label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onBlur={onBlur}
      />
    </label>
  ),
}));

vi.mock('@alga-psa/ui/components/CustomSelect', () => ({
  default: ({ id, value, onValueChange, options }: any) => (
    <label htmlFor={id}>
      {id}
      <select id={id} aria-label={id} value={value} onChange={(event) => onValueChange(event.target.value)}>
        {options.map((option: { value: string; label: string }) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  ),
}));

vi.mock('@alga-psa/ui/components/SearchableSelect', () => ({
  default: ({ id, value, onChange, placeholder }: any) => (
    <label htmlFor={id}>
      {id}
      <input
        id={id}
        aria-label={id}
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  ),
}));

const countries = [
  { code: 'US', name: 'United States', phone_code: '+1' },
];

afterEach(() => {
  cleanup();
});

function EditorHarness({ initialRows }: { initialRows: ContactPhoneNumberInput[] }) {
  const [rows, setRows] = React.useState<ContactPhoneNumberInput[]>(initialRows);
  return (
    <ContactPhoneNumbersEditor
      id="contact-phone-editor"
      value={rows}
      onChange={setRows}
      countries={countries}
      customTypeSuggestions={['Desk Line', 'After Hours']}
    />
  );
}

describe('ContactPhoneNumbersEditor', () => {
  it('T016: lets a user add a second phone row, assign a custom type, and switch the default row', async () => {
    const user = userEvent.setup();

    render(
      <EditorHarness
        initialRows={[
          {
            phone_number: '+1 555 111 2222',
            canonical_type: 'work',
            is_default: true,
            display_order: 0,
          },
        ]}
      />
    );

    await user.click(screen.getAllByRole('button', { name: /add phone/i })[0]!);

    const phoneInputs = screen.getAllByLabelText('Phone Number');
    await user.clear(phoneInputs[1]!);
    await user.type(phoneInputs[1]!, '+1 555 333 4444');

    await user.selectOptions(screen.getByLabelText('contact-phone-editor-type-1'), 'custom');
    await waitFor(() => {
      expect(screen.getByPlaceholderText('Select or enter a custom phone type')).toBeTruthy();
    });
    await user.type(screen.getByPlaceholderText('Select or enter a custom phone type'), 'Desk Line');
    await user.click(screen.getAllByRole('radio', { name: 'Default' })[1]!);

    await waitFor(() => {
      expect((screen.getByPlaceholderText('Select or enter a custom phone type') as HTMLInputElement).value).toBe('Desk Line');
      expect(screen.getAllByRole('radio', { name: 'Default' })[1]!).toBeChecked();
      expect(screen.getAllByRole('radio', { name: 'Default' })[0]!).not.toBeChecked();
    });
  });

  it('T017: renders submit-time phone validation errors passed in from the parent form', async () => {
    render(
      <ContactPhoneNumbersEditor
        id="contact-phone-editor"
        value={[
          {
            phone_number: '+1 555 111 2222',
            canonical_type: 'work',
            is_default: true,
            display_order: 0,
          },
          {
            phone_number: '+1 555 333 4444',
            canonical_type: 'mobile',
            is_default: true,
            display_order: 1,
          },
        ]}
        onChange={vi.fn()}
        countries={countries}
        customTypeSuggestions={['Desk Line', 'After Hours']}
        errorMessages={['Select exactly one default phone number.']}
      />
    );

    expect(await screen.findByText('Select exactly one default phone number.')).toBeInTheDocument();
  });

  it('T018: defers incomplete phone validation until the user blurs the phone input', async () => {
    render(
      <EditorHarness
        initialRows={[
          {
            phone_number: '+1',
            canonical_type: 'work',
            is_default: true,
            display_order: 0,
          },
        ]}
      />
    );

    expect(screen.queryByText('Phone 1: Enter a complete phone number.')).not.toBeInTheDocument();

    fireEvent.blur(screen.getByLabelText('Phone Number'));

    expect(await screen.findByText('Phone 1: Enter a complete phone number.')).toBeInTheDocument();
  });
});
