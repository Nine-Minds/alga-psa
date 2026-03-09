/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
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
  PhoneInput: ({ id, label, value, onChange }: any) => (
    <label htmlFor={id}>
      {label}
      <input id={id} aria-label={label} value={value} onChange={(event) => onChange(event.target.value)} />
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
      expect(screen.getByPlaceholderText('Enter a custom phone type')).toBeInTheDocument();
    });
    await user.type(screen.getByPlaceholderText('Enter a custom phone type'), 'Desk Line');
    await user.click(screen.getByTestId('contact-phone-editor-default-1'));

    await waitFor(() => {
      expect(screen.getByPlaceholderText('Enter a custom phone type')).toHaveValue('DeskLine');
      expect(screen.getByTestId('contact-phone-editor-default-1')).toBeChecked();
      expect(screen.getByTestId('contact-phone-editor-default-0')).not.toBeChecked();
    });
  });

  it('T017: surfaces a validation error when multiple phone rows are marked as default', async () => {
    render(
      <EditorHarness
        initialRows={[
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
      />
    );

    expect(await screen.findByText('Select exactly one default phone number.')).toBeInTheDocument();
  });
});
