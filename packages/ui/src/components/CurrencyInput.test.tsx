/** @vitest-environment jsdom */

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import {
  CurrencyInput,
  formatCurrencyValue,
  parseCurrencyValue,
} from './CurrencyInput';

let mockLocale: string | null = 'en';

vi.mock('../lib/i18n/client', () => ({
  useOptionalI18n: () => (mockLocale ? { locale: mockLocale } : null),
}));

vi.mock('../ui-reflection/useAutomationIdAndRegister', () => ({
  useAutomationIdAndRegister: () => ({
    automationIdProps: {},
    updateMetadata: vi.fn(),
  }),
}));

describe('parseCurrencyValue', () => {
  it('parses fr decimal comma: "12,5" → 12.5', () => {
    expect(parseCurrencyValue('12,5', 'fr')).toBe(12.5);
  });

  it('parses de grouped input: "1.234,56" → 1234.56', () => {
    expect(parseCurrencyValue('1.234,56', 'de')).toBe(1234.56);
  });

  it('parses en grouped input: "1,234.56" → 1234.56 (no regression)', () => {
    expect(parseCurrencyValue('1,234.56', 'en')).toBe(1234.56);
  });

  it('parses fr input typed with regular spaces: "1 234,56" → 1234.56', () => {
    expect(parseCurrencyValue('1 234,56', 'fr')).toBe(1234.56);
  });

  it('returns NaN for non-numeric input', () => {
    expect(parseCurrencyValue('abc', 'en')).toBeNaN();
    expect(parseCurrencyValue('', 'de')).toBeNaN();
  });
});

describe('format/parse round-trip', () => {
  const locales = ['en', 'de', 'fr', 'pl'];
  const values = [0, 0.5, 999, 1234.56, 1000000.01];

  for (const locale of locales) {
    for (const value of values) {
      it(`is lossless for ${value} under ${locale}`, () => {
        const formatted = formatCurrencyValue(value, locale);
        expect(parseCurrencyValue(formatted, locale)).toBe(value);
        expect(formatCurrencyValue(parseCurrencyValue(formatted, locale), locale)).toBe(formatted);
      });
    }
  }
});

describe('CurrencyInput component', () => {
  afterEach(() => {
    cleanup();
    mockLocale = 'en';
  });

  it('formats initial value per locale (de: 1.234,56 / fr: 1 234,56)', () => {
    mockLocale = 'de';
    const { unmount } = render(<CurrencyInput id="c" value={1234.56} />);
    expect(screen.getByDisplayValue(formatCurrencyValue(1234.56, 'de'))).toBeTruthy();
    expect(formatCurrencyValue(1234.56, 'de')).toBe('1.234,56');
    unmount();

    mockLocale = 'fr';
    render(<CurrencyInput id="c" value={1234.56} />);
    const input = screen.getByRole('textbox') as HTMLInputElement;
    expect(input.value).toBe(formatCurrencyValue(1234.56, 'fr'));
    expect(formatCurrencyValue(1234.56, 'fr').replace(/[\u00A0\u202F]/g, ' ')).toBe('1 234,56');
  });

  it('fires onChange(12.5) when typing "12,5" under fr — not 125 or 1250', () => {
    mockLocale = 'fr';
    const onChange = vi.fn();
    render(<CurrencyInput id="c" onChange={onChange} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '12,5' } });
    expect(onChange).toHaveBeenLastCalledWith(12.5);
  });

  it('fires onChange(1234.56) when typing "1.234,56" under de', () => {
    mockLocale = 'de';
    const onChange = vi.fn();
    render(<CurrencyInput id="c" onChange={onChange} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '1.234,56' } });
    expect(onChange).toHaveBeenLastCalledWith(1234.56);
  });

  it('fires onChange(1234.56) when typing "1,234.56" under en (no regression)', () => {
    mockLocale = 'en';
    const onChange = vi.fn();
    render(<CurrencyInput id="c" onChange={onChange} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '1,234.56' } });
    expect(onChange).toHaveBeenLastCalledWith(1234.56);
  });

  it('reformats to locale display on blur', () => {
    mockLocale = 'de';
    render(<CurrencyInput id="c" />);
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: '1234,5' } });
    fireEvent.blur(input);
    expect((input as HTMLInputElement).value).toBe('1.234,50');
  });

  it('clears and fires onChange(undefined) on invalid input in every tested locale', () => {
    for (const locale of ['en', 'de', 'fr', 'pl']) {
      mockLocale = locale;
      const onChange = vi.fn();
      const { unmount } = render(<CurrencyInput id="c" onChange={onChange} />);
      const input = screen.getByRole('textbox');
      fireEvent.change(input, { target: { value: 'abc' } });
      expect(onChange).toHaveBeenLastCalledWith(undefined);
      fireEvent.blur(input);
      expect((input as HTMLInputElement).value).toBe('');
      unmount();
    }
  });

  it('renders without an I18nProvider, defaulting to en formatting', () => {
    mockLocale = null;
    render(<CurrencyInput id="c" value={1234.56} />);
    expect(screen.getByDisplayValue('1,234.56')).toBeTruthy();
  });

  it('shows the selected currency as a non-editable adornment and keeps JPY at zero decimals', () => {
    render(<CurrencyInput id="c" value={1234} currencyCode="JPY" />);

    expect(screen.getByText('¥').getAttribute('aria-hidden')).toBe('true');
    expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe('1,234');
  });
});

describe('CurrencyInput with a controlled parent', () => {
  afterEach(() => {
    cleanup();
    mockLocale = 'en';
  });

  function ControlledHarness({
    initialValue,
    externalValue,
    onValueChange,
  }: {
    initialValue?: number;
    externalValue?: number;
    onValueChange?: (value: number | undefined) => void;
  }) {
    const [value, setValue] = React.useState<number | undefined>(initialValue);
    return (
      <>
        <CurrencyInput
          id="c"
          value={value}
          onChange={(next) => {
            setValue(next);
            onValueChange?.(next);
          }}
        />
        <button type="button" onClick={() => setValue(externalValue)}>
          set externally
        </button>
      </>
    );
  }

  it('keeps typed digits intact instead of reformatting each keystroke', () => {
    const onValueChange = vi.fn();
    render(<ControlledHarness onValueChange={onValueChange} />);
    const input = screen.getByRole('textbox') as HTMLInputElement;

    for (const keystroke of ['1', '12', '123']) {
      fireEvent.change(input, { target: { value: keystroke } });
      expect(input.value).toBe(keystroke);
    }
    expect(onValueChange).toHaveBeenLastCalledWith(123);

    fireEvent.blur(input);
    expect(input.value).toBe('123.00');
  });

  it('keeps a decimal in progress ("12." then "12.5") while editing', () => {
    const onValueChange = vi.fn();
    render(<ControlledHarness onValueChange={onValueChange} />);
    const input = screen.getByRole('textbox') as HTMLInputElement;

    fireEvent.change(input, { target: { value: '12.' } });
    expect(input.value).toBe('12.');

    fireEvent.change(input, { target: { value: '12.5' } });
    expect(input.value).toBe('12.5');
    expect(onValueChange).toHaveBeenLastCalledWith(12.5);

    fireEvent.blur(input);
    expect(input.value).toBe('12.50');
  });

  it('clears to an empty field and undefined value', () => {
    const onValueChange = vi.fn();
    render(<ControlledHarness initialValue={42} onValueChange={onValueChange} />);
    const input = screen.getByRole('textbox') as HTMLInputElement;
    expect(input.value).toBe('42.00');

    fireEvent.change(input, { target: { value: '' } });
    expect(input.value).toBe('');
    expect(onValueChange).toHaveBeenLastCalledWith(undefined);

    fireEvent.blur(input);
    expect(input.value).toBe('');
  });

  it('still picks up external value changes (form reset)', () => {
    render(<ControlledHarness initialValue={10} externalValue={99.5} />);
    const input = screen.getByRole('textbox') as HTMLInputElement;

    fireEvent.change(input, { target: { value: '123' } });
    expect(input.value).toBe('123');

    fireEvent.click(screen.getByRole('button', { name: 'set externally' }));
    expect(input.value).toBe('99.50');
  });

  it('resets the display when an external change clears the value', () => {
    render(<ControlledHarness initialValue={10} externalValue={undefined} />);
    const input = screen.getByRole('textbox') as HTMLInputElement;

    fireEvent.change(input, { target: { value: '55' } });
    expect(input.value).toBe('55');

    fireEvent.click(screen.getByRole('button', { name: 'set externally' }));
    expect(input.value).toBe('');
  });

  it('keeps a comma decimal separator while typing under fr', () => {
    mockLocale = 'fr';
    const onValueChange = vi.fn();
    render(<ControlledHarness onValueChange={onValueChange} />);
    const input = screen.getByRole('textbox') as HTMLInputElement;

    fireEvent.change(input, { target: { value: '12' } });
    expect(input.value).toBe('12');

    fireEvent.change(input, { target: { value: '12,5' } });
    expect(input.value).toBe('12,5');
    expect(onValueChange).toHaveBeenLastCalledWith(12.5);

    fireEvent.blur(input);
    expect(input.value).toBe(formatCurrencyValue(12.5, 'fr'));
  });
});
