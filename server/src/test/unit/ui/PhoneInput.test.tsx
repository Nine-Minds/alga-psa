/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { PhoneInput } from '@alga-psa/ui/components/PhoneInput';

const countries = [
  { code: 'US', name: 'United States', phone_code: '+1' },
  { code: 'GB', name: 'United Kingdom', phone_code: '+44' },
];

describe('PhoneInput', () => {
  it('keeps the local number clean when country metadata catches up after reload', () => {
    const onChange = vi.fn();
    const { container, rerender } = render(
      <PhoneInput
        id="phone"
        label="Phone Number"
        value="+44 20 7123 4567"
        onChange={onChange}
        countryCode="US"
        phoneCode="+1"
        countries={countries}
      />
    );

    rerender(
      <PhoneInput
        id="phone"
        label="Phone Number"
        value="+44 20 7123 4567"
        onChange={onChange}
        countryCode="GB"
        phoneCode="+44"
        countries={countries}
      />
    );

    expect((container.querySelector('input[type="tel"]') as HTMLInputElement).value).toBe('20 7123 4567');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('shows a visible country code on a blank create form row', () => {
    render(
      <PhoneInput
        id="blank-phone"
        label="Phone Number"
        value=""
        onChange={vi.fn()}
        countryCode="US"
        countries={countries}
      />
    );

    expect(screen.getByRole('button', { name: /\+1/i })).toBeTruthy();
  });

  it('rewrites the stored full number only when the user picks a different country', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(
      <PhoneInput
        id="editable-phone"
        label="Phone Number"
        value="+1 555 123 4567"
        onChange={onChange}
        countryCode="US"
        phoneCode="+1"
        countries={countries}
      />
    );

    await user.click(screen.getByRole('button', { name: /\+1/i }));
    await user.click(screen.getByRole('button', { name: /United Kingdom/i }));

    expect(onChange).toHaveBeenLastCalledWith('+44 555 123 4567');
  });
});
