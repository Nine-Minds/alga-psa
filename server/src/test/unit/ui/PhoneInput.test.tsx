/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PhoneInput } from '@alga-psa/ui/components/PhoneInput';

const countries = [
  { code: 'US', name: 'United States', phone_code: '+1' },
  { code: 'GB', name: 'United Kingdom', phone_code: '+44' },
];

describe('PhoneInput', () => {
  // RTL auto-cleanup only registers for the first test file in the shared fork,
  // so clean up explicitly to avoid duplicate renders leaking between tests.
  afterEach(() => {
    cleanup();
  });

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

  it('does not stack the picker dial code on a number that brought its own', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(
      <PhoneInput
        id="pasted-phone"
        label="Phone Number"
        value=""
        onChange={onChange}
        countryCode="US"
        phoneCode="+1"
        countries={countries}
      />
    );

    // "+1 +44 …" parses as nothing, which used to be stored silently and now
    // blocks the save — so the prefix must not be added twice.
    await user.type(screen.getByRole('textbox'), '+442079460958');

    expect(onChange).toHaveBeenLastCalledWith('+442079460958');
  });

  it('still adds the picker dial code to a bare national number', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(
      <PhoneInput
        id="national-phone"
        label="Phone Number"
        value=""
        onChange={onChange}
        countryCode="US"
        phoneCode="+1"
        countries={countries}
      />
    );

    await user.type(screen.getByRole('textbox'), '4155550123');

    expect(onChange).toHaveBeenLastCalledWith('+1 4155550123');
  });

  it('keeps a stored number on its own dial code when the picker disagrees', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    // The location editor binds the picker to the *address* country, so a UK
    // number sits under a +1 picker. Correcting a digit must not re-home it.
    render(
      <PhoneInput
        id="foreign-phone"
        label="Phone Number"
        value="+442079460958"
        onChange={onChange}
        countryCode="US"
        phoneCode="+1"
        countries={countries}
      />
    );

    expect(screen.getByRole('button', { name: /\+44/i })).toBeTruthy();

    await user.type(screen.getByRole('textbox'), '9');

    expect(onChange).toHaveBeenLastCalledWith('+44 20794609589');
  });

  it('homes a number typed before the country list arrived', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    // QuickAddContact fetches countries when the dialog opens, so the first row can
    // render before any dial code is known while the picker already reads "+1".
    const { rerender } = render(
      <PhoneInput id="racing-phone" label="Phone Number" value="" onChange={onChange} countryCode="US" countries={[]} />
    );

    await user.type(screen.getByRole('textbox'), '2125550147');
    expect(onChange).toHaveBeenLastCalledWith('2125550147');

    rerender(
      <PhoneInput
        id="racing-phone"
        label="Phone Number"
        value="2125550147"
        onChange={onChange}
        countryCode="US"
        phoneCode="+1"
        countries={countries}
      />
    );

    expect(onChange).toHaveBeenLastCalledWith('+1 2125550147');
  });

  it('leaves a stored dial-code-less number alone', () => {
    const onChange = vi.fn();

    // Legacy rows are grandfathered: re-homing one here would mark it changed and
    // block an edit to some unrelated field on the same record.
    const { rerender } = render(
      <PhoneInput id="legacy-phone" label="Phone Number" value="555-123-4567" onChange={onChange} countryCode="US" countries={[]} />
    );

    rerender(
      <PhoneInput
        id="legacy-phone"
        label="Phone Number"
        value="555-123-4567"
        onChange={onChange}
        countryCode="US"
        phoneCode="+1"
        countries={countries}
      />
    );

    expect(onChange).not.toHaveBeenCalled();
  });

  it('clears to empty rather than to a bare dial code', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(
      <PhoneInput
        id="cleared-phone"
        label="Phone Number"
        value="+442079460958"
        onChange={onChange}
        countryCode="US"
        phoneCode="+1"
        countries={countries}
      />
    );

    await user.clear(screen.getByRole('textbox'));

    expect(onChange).toHaveBeenLastCalledWith('');
  });
});
