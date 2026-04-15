/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ContactEmailAddressInput } from '@alga-psa/types';
import ContactEmailAddressesEditor from '@alga-psa/clients/components/contacts/ContactEmailAddressesEditor';

vi.mock('@alga-psa/types', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...(actual as object),
    CONTACT_EMAIL_CANONICAL_TYPES: ['work', 'personal', 'billing', 'other'],
  };
});

vi.mock('@alga-psa/ui/components/Alert', () => ({
  Alert: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  AlertDescription: ({ children, ...props }: any) => <div {...props}>{children}</div>,
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

vi.mock('@alga-psa/ui/components/Label', () => ({
  Label: ({ children, ...props }: any) => <label {...props}>{children}</label>,
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

afterEach(() => {
  cleanup();
});

function EditorHarness({
  initialValue,
  errorMessages,
  compactAdditionalRows,
}: {
  initialValue?: {
    email: string;
    primary_email_canonical_type: 'work' | 'personal' | 'billing' | 'other' | null;
    primary_email_custom_type?: string | null;
    additional_email_addresses: ContactEmailAddressInput[];
  };
  errorMessages?: string[];
  compactAdditionalRows?: boolean;
}) {
  const [value, setValue] = React.useState(
    initialValue ?? {
      email: 'primary@example.com',
      primary_email_canonical_type: 'work' as const,
      primary_email_custom_type: null,
      additional_email_addresses: [] as ContactEmailAddressInput[],
    }
  );

  return (
    <ContactEmailAddressesEditor
      id="contact-email-editor"
      compactAdditionalRows={compactAdditionalRows}
      value={value}
      onChange={setValue}
      customTypeSuggestions={['Escalations', 'Billing Inbox']}
      errorMessages={errorMessages}
    />
  );
}

describe('ContactEmailAddressesEditor', () => {
  it('T018: renders a pinned primary row, lets a user add and reorder additional rows, and preserves normalized ordering', async () => {
    const user = userEvent.setup();

    render(
      <EditorHarness
        initialValue={{
          email: 'primary@example.com',
          primary_email_canonical_type: 'work',
          additional_email_addresses: [
            {
              email_address: 'billing@example.com',
              canonical_type: 'billing',
              custom_type: null,
              display_order: 0,
            },
          ],
        }}
      />
    );

    expect(screen.getByTestId('contact-email-editor-primary-row')).toBeInTheDocument();
    expect(screen.getByDisplayValue('primary@example.com')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /add email/i }));
    const emailInputs = screen.getAllByRole('textbox').filter((element) => {
      const input = element as HTMLInputElement;
      return input.type === 'email';
    });
    await user.type(emailInputs[2]!, 'alerts@example.com');

    await user.click(screen.getByRole('button', { name: /move additional email 2 up/i }));

    const additionalRows = screen.getAllByTestId(/contact-email-editor-additional-row-/);
    const firstAdditionalEmail = additionalRows[0]!.querySelector('input[type="email"]') as HTMLInputElement;
    const secondAdditionalEmail = additionalRows[1]!.querySelector('input[type="email"]') as HTMLInputElement;

    await waitFor(() => {
      expect(firstAdditionalEmail.value).toBe('alerts@example.com');
      expect(secondAdditionalEmail.value).toBe('billing@example.com');
    });
  });

  it('T019: supports canonical and custom label editing for primary and additional rows', async () => {
    const user = userEvent.setup();

    render(<EditorHarness />);

    await user.selectOptions(screen.getByLabelText('contact-email-editor-primary-type'), 'custom');
    await waitFor(() => {
      expect(screen.getByPlaceholderText('Select or enter a custom email label')).toBeInTheDocument();
    });
    await user.type(screen.getByPlaceholderText('Select or enter a custom email label'), 'Escalations');

    await user.click(screen.getByRole('button', { name: /add email/i }));
    const additionalRow = screen.getByTestId('contact-email-editor-additional-row-0');
    await user.type(within(additionalRow).getByLabelText('Email Address'), 'billing@example.com');
    await user.selectOptions(screen.getByLabelText('contact-email-editor-additional-type-0'), 'billing');

    await waitFor(() => {
      expect((screen.getByLabelText('contact-email-editor-primary-custom-type') as HTMLInputElement).value).toBe('Escalations');
      expect((screen.getByLabelText('contact-email-editor-additional-type-0') as HTMLSelectElement).value).toBe('billing');
    });
  });

  it('defers incomplete additional-email validation until the user blurs that row', async () => {
    const user = userEvent.setup();

    render(
      <EditorHarness
        initialValue={{
          email: 'primary@example.com',
          primary_email_canonical_type: 'work',
          additional_email_addresses: [
            {
              email_address: 'not-an-email',
              canonical_type: 'billing',
              custom_type: null,
              display_order: 0,
            },
          ],
        }}
      />
    );

    expect(screen.queryByText('Additional email 1: Enter a valid email address.')).not.toBeInTheDocument();

    const additionalRow = screen.getByTestId('contact-email-editor-additional-row-0');
    const additionalEmailInput = within(additionalRow).getByLabelText('Email Address');
    await user.click(additionalEmailInput);
    fireEvent.blur(additionalEmailInput);

    expect(await screen.findByText('Additional email 1: Enter a valid email address.')).toBeInTheDocument();
  });

  it('renders submit-time validation errors passed in by the parent form', async () => {
    render(
      <EditorHarness
        errorMessages={['Primary email: Enter a valid email address.']}
      />
    );

    expect(await screen.findByText('Primary email: Enter a valid email address.')).toBeInTheDocument();
  });

  it('does not emit duplicate-key warnings when promoting an existing additional row', async () => {
    const user = userEvent.setup();
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    render(
      <EditorHarness
        compactAdditionalRows={true}
        initialValue={{
          email: 'primary@example.com',
          primary_email_canonical_type: 'work',
          additional_email_addresses: [
            {
              contact_additional_email_address_id: '2f6e00ec-6e98-43e0-987a-ea90f88f4e80',
              email_address: 'billing@example.com',
              canonical_type: 'billing',
              custom_type: null,
              display_order: 0,
            },
            {
              contact_additional_email_address_id: 'ba9f91fb-bb4f-4ebd-9048-39efc33c2d58',
              email_address: 'escalations@example.com',
              canonical_type: null,
              custom_type: 'Escalations',
              display_order: 1,
            },
          ],
        }}
      />
    );

    const firstAdditionalRow = screen.getByTestId('contact-email-editor-additional-row-0');
    await user.click(within(firstAdditionalRow).getByRole('radio'));

    expect(
      consoleErrorSpy.mock.calls.some(([firstArg]) =>
        String(firstArg).includes('Encountered two children with the same key')
      )
    ).toBe(false);
  });

  it('renders additional rows in compact mode until the user expands one for editing', async () => {
    const user = userEvent.setup();

    render(
      <EditorHarness
        compactAdditionalRows={true}
        initialValue={{
          email: 'primary@example.com',
          primary_email_canonical_type: 'work',
          additional_email_addresses: [
            {
              email_address: 'billing@example.com',
              canonical_type: 'billing',
              custom_type: null,
              display_order: 0,
            },
          ],
        }}
      />
    );

    const additionalRow = screen.getByTestId('contact-email-editor-additional-row-0');
    expect(within(additionalRow).getByText('billing@example.com')).toBeInTheDocument();
    expect(within(additionalRow).queryByLabelText('Email Address')).not.toBeInTheDocument();

    await user.click(within(additionalRow).getByRole('button', { name: /edit/i }));

    await waitFor(() => {
      expect(within(additionalRow).getByLabelText('Email Address')).toBeInTheDocument();
    });
  });
});
