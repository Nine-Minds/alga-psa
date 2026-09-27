/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { UnitOfMeasureInput, type UnitSelection } from '../UnitOfMeasureInput';

vi.mock('../../lib/i18n/client', () => ({
  useTranslation: () => ({ t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key }),
}));

vi.mock('../CustomSelect', () => ({
  default: ({ options, value, onValueChange, id }: {
    options: Array<{ value: string; label: string | React.ReactElement }>;
    value: string;
    onValueChange: (value: string) => void;
    id: string;
  }) => {
    const emittedEmptyFor = React.useRef('');
    React.useEffect(() => {
      if (value.startsWith('custom:') && options.some((option) => option.value === value) && emittedEmptyFor.current !== value) {
        emittedEmptyFor.current = value;
        onValueChange('');
      }
    }, [onValueChange, options, value]);
    return <div>
      <button id={id} type="button">{String(options.find((option) => option.value === value)?.label ?? 'Select a unit')}</button>
      {options.filter((option) => !option.value.startsWith('group-')).map((option) => (
        <button key={option.value} type="button" onClick={() => onValueChange(option.value)}>{option.label}</button>
      ))}
    </div>;
  },
}));

afterEach(cleanup);

describe('UnitOfMeasureInput', () => {
  it('keeps a registered custom unit selected after Add', async () => {
    const onChange = vi.fn();
    const registerCustomUnit = vi.fn(async (label: string): Promise<UnitSelection> => ({ code: 'C62', label }));
    function ControlledInput() {
      const [value, setValue] = React.useState<UnitSelection>({ code: '', label: '' });
      return <UnitOfMeasureInput id="unit-of-measure-test" value={value} onChange={(selection: UnitSelection) => { onChange(selection); setValue(selection); }} registerCustomUnit={registerCustomUnit} />;
    }

    render(<ControlledInput />);
    fireEvent.click(screen.getByRole('button', { name: 'Custom…' }));
    fireEvent.change(screen.getByPlaceholderText('Name this unit'), { target: { value: 'Mailbox' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));

    await waitFor(() => expect(document.getElementById('unit-of-measure-test')?.textContent).toBe('Mailbox'));
    expect(registerCustomUnit).toHaveBeenCalledWith('Mailbox');
    expect(onChange).toHaveBeenLastCalledWith({ code: 'C62', label: 'Mailbox' });
  });
});
