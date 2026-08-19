/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PhoneInput } from '@alga-psa/ui/components/PhoneInput';

const countries = [
  { code: 'US', name: 'United States', phone_code: '+1' },
  { code: 'GB', name: 'United Kingdom', phone_code: '+44' },
];

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
        phoneCode="+1"
        countries={countries}
      />
    );

    expect(screen.getByLabelText('Phone')).toHaveValue('+44 20 7123 4567');
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('passes the entered number through directly without adding a country prefix', () => {
    const onChange = vi.fn();

    render(
      <PhoneInput
        id="direct-phone"
        label="Phone"
        value=""
        onChange={onChange}
        countryCode="US"
        phoneCode="+1"
        countries={countries}
      />
    );

    fireEvent.change(screen.getByLabelText('Phone'), { target: { value: '4155550123' } });

    expect(onChange).toHaveBeenLastCalledWith('4155550123');
    expect(onChange).not.toHaveBeenCalledWith(expect.stringContaining('+1'));
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

  it('uses a wrapping layout with a growing phone field and narrow extension field', () => {
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

    expect(container.firstElementChild).toHaveClass('flex-wrap');
    expect(screen.getByLabelText('Phone').parentElement?.parentElement).toHaveClass('min-w-[min(100%,16rem)]');
    expect(screen.getByLabelText('Extension').parentElement?.parentElement).toHaveClass('sm:w-28');
  });
});
