/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PhoneInput } from '@alga-psa/ui/components/PhoneInput';

describe('PhoneInput', () => {
  afterEach(cleanup);

  it('renders one ordinary full-number input without a country-prefix control', () => {
    render(
      <PhoneInput
        id="phone"
        label="Phone"
        value="+44 20 7123 4567"
        onChange={vi.fn()}
        countryCode="US"
      />
    );

    expect(screen.getByLabelText('Phone')).toHaveValue('+44 20 7123 4567');
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('formats national input and emits its E.164 value', () => {
    const onChange = vi.fn();

    const { rerender } = render(
      <PhoneInput
        id="direct-phone"
        label="Phone"
        value=""
        onChange={onChange}
        countryCode="US"
      />
    );

    fireEvent.change(screen.getByLabelText('Phone'), { target: { value: '4155550123' } });

    expect(onChange).toHaveBeenLastCalledWith('+14155550123');

    rerender(
      <PhoneInput
        id="direct-phone"
        label="Phone"
        value="+14155550123"
        onChange={onChange}
        countryCode="US"
      />
    );
    expect(screen.getByLabelText('Phone')).toHaveValue('(415) 555-0123');
  });

  it('renders extension as a separate digit-only input', () => {
    const onExtensionChange = vi.fn();

    render(
      <PhoneInput
        id="phone-with-extension"
        label="Phone"
        value="+1 212 555 0100"
        onChange={vi.fn()}
        extension=""
        onExtensionChange={onExtensionChange}
        allowExtensions
      />
    );

    const phone = screen.getByLabelText('Phone');
    const extension = screen.getByLabelText('Extension');
    expect(phone).not.toBe(extension);
    expect(extension).toHaveAttribute('inputmode', 'numeric');
    expect(extension).toHaveAttribute('maxlength', '10');

    fireEvent.change(extension, { target: { value: 'desk 600' } });
    expect(onExtensionChange).toHaveBeenLastCalledWith('600');
  });

  it('keeps the phone and compact extension fields on the same row', () => {
    const { container } = render(
      <PhoneInput
        id="responsive-phone"
        label="Phone"
        value=""
        onChange={vi.fn()}
        extension="300"
        onExtensionChange={vi.fn()}
        allowExtensions
      />
    );

    const fields = container.querySelector('[data-automation-type="phone-input-fields"]');
    expect(fields).toHaveClass('grid');
    expect(fields).toHaveClass('grid-cols-[minmax(0,1fr)_5.5rem]');
    expect(fields).not.toHaveClass('flex-wrap');
  });

  it('uses the same label spacing as adjacent form controls', () => {
    const { container } = render(
      <PhoneInput id="aligned-phone" label="Phone" value="" onChange={vi.fn()} />
    );

    expect(container.firstElementChild).toHaveClass('space-y-1');
    expect(screen.getByText('Phone')).toHaveClass('block');
  });

  it('keeps focus in the phone field while entering a variable-length international number', () => {
    render(
      <PhoneInput
        id="variable-length-phone"
        label="Phone"
        value=""
        onChange={vi.fn()}
        countryCode="BY"
        extension=""
        onExtensionChange={vi.fn()}
        allowExtensions
      />
    );

    const phone = screen.getByLabelText('Phone');
    phone.focus();
    fireEvent.change(phone, { target: { value: '+375293825' } });

    expect(phone).toHaveFocus();
    expect(screen.getByLabelText('Extension')).not.toHaveFocus();
  });

  it('moves focus to the extension when Enter is pressed', () => {
    render(
      <PhoneInput
        id="keyboard-advance-phone"
        label="Phone"
        value="+375293825886"
        onChange={vi.fn()}
        countryCode="BY"
        extension=""
        onExtensionChange={vi.fn()}
        allowExtensions
      />
    );

    const phone = screen.getByLabelText('Phone');
    phone.focus();
    fireEvent.keyDown(phone, { key: 'Enter' });

    expect(screen.getByLabelText('Extension')).toHaveFocus();
  });

  it('does not crash when typing beyond the maximum phone number length', async () => {
    const user = userEvent.setup();

    function ControlledPhoneInput() {
      const [value, setValue] = React.useState('');
      return (
        <PhoneInput
          id="long-phone"
          label="Phone"
          value={value}
          onChange={setValue}
          countryCode="BY"
        />
      );
    }

    render(<ControlledPhoneInput />);
    await user.type(screen.getByLabelText('Phone'), '29382588612345678901');

    const phone = screen.getByLabelText('Phone');
    expect(phone).toBeInTheDocument();
    // E.164 allows 15 digits total. Belarus's +375 prefix leaves 12 national digits.
    expect((phone as HTMLInputElement).value.replace(/\D/g, '')).toHaveLength(12);
  });

  it('preserves an existing overlong value without sending it through the formatter', () => {
    render(
      <PhoneInput
        id="existing-long-phone"
        label="Phone"
        value="+37529382588612345678"
        onChange={vi.fn()}
        countryCode="BY"
      />
    );

    expect(screen.getByLabelText('Phone')).toHaveValue('+37529382588612345678');
  });

  it('preserves an unparseable legacy value as editable text', () => {
    const onChange = vi.fn();
    render(
      <PhoneInput
        id="legacy-phone"
        label="Phone"
        value="desk line 12"
        onChange={onChange}
        countryCode="US"
      />
    );

    expect(screen.getByLabelText('Phone')).toHaveValue('desk line 12');
    fireEvent.change(screen.getByLabelText('Phone'), { target: { value: 'desk line 123' } });
    expect(onChange).toHaveBeenLastCalledWith('desk line 123');
  });
});
