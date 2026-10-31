/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useOptionalI18n: () => null,
  useTranslation: () => ({
    t: (key: string, o?: string | { defaultValue?: string }) =>
      !o ? key : typeof o === 'string' ? o : o.defaultValue ?? key,
  }),
  useFormatters: () => ({ locale: 'en-US', formatNumber: (v: number) => String(v) }),
}));
vi.mock('../../ServiceCatalogPicker', () => ({ ServiceCatalogPicker: () => null }));
vi.mock('../../../service-configurations/FixedServiceConfigPanel', () => ({ FixedServiceConfigPanel: () => null }));
vi.mock('../TemplateServicePreviewSection', () => ({ TemplateServicePreviewSection: () => null }));

import type { TemplateWizardData } from '../TemplateWizard';
import { TemplateFixedFeeServicesStep } from './TemplateFixedFeeServicesStep';

const data: TemplateWizardData = {
  contract_name: 'T', billing_frequency: 'monthly', fixed_services: [], product_services: [], hourly_services: [],
};

afterEach(() => cleanup());

describe('TemplateFixedFeeServicesStep invoice title/subtitle (F007)', () => {
  it('captures the invoice title and subtitle', () => {
    const updateData = vi.fn();
    render(<TemplateFixedFeeServicesStep data={{ ...data, invoice_line_subtitle: 'Existing' }} updateData={updateData} />);
    fireEvent.change(screen.getByLabelText('Invoice title (optional)'), { target: { value: 'Managed IT' } });
    expect(updateData).toHaveBeenCalledWith({ invoice_line_description: 'Managed IT' });
    expect((screen.getByLabelText('Invoice subtitle (optional)') as HTMLInputElement).value).toBe('Existing');
    fireEvent.change(screen.getByLabelText('Invoice subtitle (optional)'), { target: { value: 'Seats' } });
    expect(updateData).toHaveBeenCalledWith({ invoice_line_subtitle: 'Seats' });
  });
});
