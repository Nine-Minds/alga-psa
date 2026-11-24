// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
  }),
}));

import { ValueLabelsEditor } from './ValueLabelsEditor';

afterEach(cleanup);

const labelInputs = () => screen.getAllByLabelText('Printed wording') as HTMLInputElement[];

describe('ValueLabelsEditor follows its valueLabels prop', () => {
  it('shows the new rows when the prop changes and commits the new value, not the old one', () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <ValueLabelsEditor domId="col-a" valueLabels={{ true: 'Included' }} suggestions={[]} onChange={onChange} />
    );
    expect(labelInputs().map((input) => input.value)).toEqual(['Included']);

    rerender(
      <ValueLabelsEditor domId="col-a" valueLabels={{ monthly: 'Every month', weekly: 'Every week' }} suggestions={[]} onChange={onChange} />
    );
    expect(labelInputs().map((input) => input.value)).toEqual(['Every month', 'Every week']);

    fireEvent.blur(labelInputs()[0]!);
    expect(onChange).toHaveBeenLastCalledWith({ monthly: 'Every month', weekly: 'Every week' });
  });

  it('clears the rows when the prop becomes undefined', () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <ValueLabelsEditor domId="col-a" valueLabels={{ true: 'Included' }} suggestions={[]} onChange={onChange} />
    );
    rerender(<ValueLabelsEditor domId="col-a" valueLabels={undefined} suggestions={[]} onChange={onChange} />);
    expect(screen.queryAllByLabelText('Printed wording')).toHaveLength(0);
  });

  it('keeps a blank-key draft row while the author types and the committed prop echoes back', () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <ValueLabelsEditor domId="col-a" valueLabels={{ true: 'Included' }} suggestions={[]} onChange={onChange} />
    );
    fireEvent.click(document.getElementById('col-a-add-value')!);
    // The blank-key row is not part of the committed record, so the prop is unchanged.
    expect(onChange).toHaveBeenLastCalledWith({ true: 'Included' });
    rerender(<ValueLabelsEditor domId="col-a" valueLabels={{ true: 'Included' }} suggestions={[]} onChange={onChange} />);
    expect(labelInputs()).toHaveLength(2);
  });
});
