/** @vitest-environment jsdom */

import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { NumericInput } from './NumericInput';

vi.mock('../lib/i18n/client', () => ({ useOptionalI18n: () => ({ locale: 'en' }) }));
vi.mock('../ui-reflection/useAutomationIdAndRegister', () => ({ useAutomationIdAndRegister: () => ({ automationIdProps: {}, updateMetadata: vi.fn() }) }));

describe('NumericInput', () => {
  it('is a text-backed, spinner-free numeric field and honors explicit precision', () => {
    const onChange = vi.fn();
    render(<NumericInput id="hours" value={10} precision={1} onChange={onChange} />);
    const input = screen.getByRole('textbox') as HTMLInputElement;
    expect(input.type).toBe('text');
    expect(input.value).toBe('10.0');
    fireEvent.change(input, { target: { value: '10.5' } });
    expect(onChange).toHaveBeenLastCalledWith(10.5);
  });
});
