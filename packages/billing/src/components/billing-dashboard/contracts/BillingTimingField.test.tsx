/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      String((opts?.defaultValue as string) ?? key).replace(/{{(\w+)}}/g, (_m, k) => String(opts?.[k] ?? '')),
  }),
}));
vi.mock('@alga-psa/ui/components/CustomSelect', () => ({
  default: (props: { id: string; value: string; options: Array<{ value: string; label: string }>; onValueChange: (v: string) => void }) => (
    <div data-testid={props.id} data-value={props.value}>
      {props.options.map((o) => (
        <button key={o.value} type="button" onClick={() => props.onValueChange(o.value)}>{o.label}</button>
      ))}
    </div>
  ),
}));

import { BillingTimingField } from './BillingTimingField';

const HELP = 'Hourly and usage lines always bill in arrears, after the work happens.';

describe('BillingTimingField', () => {
  afterEach(cleanup);

  it.each(['Hourly', 'Usage'])('%s lines show read-only "In Arrears" with the help line', (lineType) => {
    render(<BillingTimingField lineType={lineType} value="advance" onChange={vi.fn()} id="t" />);
    expect(screen.getByText('In Arrears')).toBeInTheDocument();
    expect(screen.getByText(HELP)).toBeInTheDocument();
    expect(screen.queryByTestId('t')).not.toBeInTheDocument();
  });

  it('Fixed lines render the select and no hourly/usage help', () => {
    render(<BillingTimingField lineType="Fixed" value="advance" onChange={vi.fn()} id="t" />);
    expect(screen.getByTestId('t')).toBeInTheDocument();
    expect(screen.queryByText(HELP)).not.toBeInTheDocument();
  });

  it('without allowInherit there is no inherit option', () => {
    render(<BillingTimingField lineType="Fixed" value={undefined} onChange={vi.fn()} id="t" />);
    expect(screen.queryByText(/Use contract default/)).not.toBeInTheDocument();
  });

  it('allowInherit selects the inherit option while unset and labels it with the effective value', () => {
    render(
      <BillingTimingField lineType="Fixed" value={undefined} onChange={vi.fn()} onInherit={vi.fn()}
        allowInherit inheritedValue="advance" id="t" />,
    );
    expect(screen.getByTestId('t')).toHaveAttribute('data-value', 'inherit');
    expect(screen.getByText('Use contract default — in advance')).toBeInTheDocument();
  });

  it('allowInherit: explicit value selected, choosing inherit calls onInherit, choosing a value calls onChange', () => {
    const onChange = vi.fn();
    const onInherit = vi.fn();
    render(
      <BillingTimingField lineType="Fixed" value="arrears" onChange={onChange} onInherit={onInherit}
        allowInherit inheritedValue="advance" id="t" />,
    );
    expect(screen.getByTestId('t')).toHaveAttribute('data-value', 'arrears');
    fireEvent.click(screen.getByText(/Use contract default/));
    expect(onInherit).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByText(/In Advance/));
    expect(onChange).toHaveBeenCalledWith('advance');
  });

  it('hourly lines stay read-only even with allowInherit', () => {
    render(<BillingTimingField lineType="Hourly" value={undefined} onChange={vi.fn()} allowInherit id="t" />);
    expect(screen.getByText('In Arrears')).toBeInTheDocument();
    expect(screen.queryByTestId('t')).not.toBeInTheDocument();
  });
});
