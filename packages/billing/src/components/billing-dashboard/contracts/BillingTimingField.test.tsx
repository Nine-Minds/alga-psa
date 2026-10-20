/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { defaultValue?: string }) => opts?.defaultValue ?? key,
  }),
}));
vi.mock('@alga-psa/ui/components/CustomSelect', () => ({
  default: (props: { id: string }) => <div data-testid={props.id} />,
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
});
