/* @vitest-environment jsdom */

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({ t: (key: string, opts?: { defaultValue?: string }) => opts?.defaultValue ?? key }),
  useI18n: () => ({ locale: 'en', setLocale: vi.fn() }),
}));
vi.mock('@alga-psa/clients/actions', () => ({ getAllCountries: vi.fn(async () => []) }));
vi.mock('@alga-psa/validation', () => ({
  translateFieldValidation: vi.fn(() => []),
  validateEmailAddressField: vi.fn(() => []),
}));
vi.mock('@alga-psa/ui/components/FieldWarnings', () => ({ FieldWarnings: () => null }));
vi.mock('@alga-psa/ui/components/Input', () => ({ Input: (props: any) => <input {...props} /> }));
vi.mock('@alga-psa/ui/components/Label', () => ({ Label: ({ children }: any) => <label>{children}</label> }));
vi.mock('@alga-psa/ui/components/CustomSelect', () => ({ default: () => <div /> }));
vi.mock('@alga-psa/ui/components/CountryPicker', () => ({ default: () => <div /> }));
vi.mock('@alga-psa/ui/components/Alert', () => ({
  Alert: ({ children }: any) => <div>{children}</div>,
  AlertDescription: ({ children }: any) => <div>{children}</div>,
}));

import { ClientInfoStep } from './ClientInfoStep';

const NEUTRAL = 'This address appears on your invoices and quotes.';
const PREFILL = 'Some of these values were filled in from your billing details. Please review them.';

const renderStep = (props: { prefilled?: boolean; isRevisit?: boolean }) =>
  render(
    <ClientInfoStep
      data={{ companyAddressPrefilled: props.prefilled } as any}
      updateData={vi.fn()}
      isRevisit={props.isRevisit}
    />,
  );

describe('ClientInfoStep company address copy', () => {
  afterEach(cleanup);

  it('shows only the neutral sentence when nothing was prefilled', () => {
    renderStep({ prefilled: false });
    expect(screen.getByText(NEUTRAL)).toBeTruthy();
    expect(screen.queryByText(PREFILL)).toBeNull();
  });

  it('shows both sentences when prefilled on the first visit', () => {
    renderStep({ prefilled: true });
    expect(screen.getByText(NEUTRAL)).toBeTruthy();
    expect(screen.getByText(PREFILL)).toBeTruthy();
  });

  it('hides the prefill sentence on a revisit', () => {
    renderStep({ prefilled: true, isRevisit: true });
    expect(screen.getByText(NEUTRAL)).toBeTruthy();
    expect(screen.queryByText(PREFILL)).toBeNull();
  });
});
