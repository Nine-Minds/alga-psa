// @vitest-environment jsdom
import React from 'react';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * Template authoring takes its billing mode from the line, not from catalog
 * billing_method: every template step offers the same services and gates only
 * on item_kind. The render-level counterpart to T012 in
 * server/src/test/unit/fixedWizardPickerPolicy.static.test.ts (see
 * ee/docs/plans/2026-03-21-service-catalog-billing-mode-decoupling, F007).
 */

const pickerProps: Array<Record<string, unknown>> = [];

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      const fallback = (options?.defaultValue as string) ?? key;
      return fallback.replace(/{{(\w+)}}/g, (_match, token) => String(options?.[token] ?? ''));
    },
  }),
  useOptionalI18n: () => null,
}));
vi.mock('../src/components/billing-dashboard/contracts/ServiceCatalogPicker', () => ({
  ServiceCatalogPicker: (props: Record<string, unknown>) => {
    pickerProps.push(props);
    return <div data-testid={`picker-${String(props.id)}`} />;
  },
}));
vi.mock('../src/components/billing-dashboard/contracts/template-wizard/TemplateServicePreviewSection', () => ({
  TemplateServicePreviewSection: () => <div />,
}));
vi.mock('../src/components/billing-dashboard/contracts/BucketOverlayFields', () => ({
  BucketOverlayFields: () => <div />,
}));
vi.mock('../src/components/service-configurations/FixedServiceConfigPanel', () => ({
  FixedServiceConfigPanel: () => <div />,
}));
vi.mock('../src/actions/unitOfMeasureActions', () => ({
  listTenantUnitsOfMeasure: async () => [],
  registerTenantUnitOfMeasure: async () => undefined,
}));

const { TemplateFixedFeeServicesStep } = await import(
  '../src/components/billing-dashboard/contracts/template-wizard/steps/TemplateFixedFeeServicesStep'
);
const { TemplateHourlyServicesStep } = await import(
  '../src/components/billing-dashboard/contracts/template-wizard/steps/TemplateHourlyServicesStep'
);
const { TemplateUsageBasedServicesStep } = await import(
  '../src/components/billing-dashboard/contracts/template-wizard/steps/TemplateUsageBasedServicesStep'
);

const baseData = {
  contract_name: 'Template',
  billing_frequency: 'monthly',
  cadence_owner: 'client' as const,
  billing_timing: 'arrears' as const,
  fixed_services: [{ service_id: '', service_name: '' }],
  product_services: [],
  hourly_services: [{ service_id: '', service_name: '' }],
  usage_services: [{ service_id: '', service_name: '', unit_of_measure: '' }],
};

describe('template wizard service pickers do not gate on catalog billing method', () => {
  afterEach(() => {
    pickerProps.length = 0;
    cleanup();
  });

  it('offers every service on the fixed fee step', () => {
    render(<TemplateFixedFeeServicesStep data={baseData as any} updateData={vi.fn()} />);

    const picker = pickerProps.find((props) => String(props.id).startsWith('template-fixed-service-'));
    expect(picker).toBeDefined();
    expect(picker!.billingMethods).toBeUndefined();
    expect(picker!.itemKinds).toEqual(['service']);
  });

  it('offers every service on the hourly step', () => {
    render(<TemplateHourlyServicesStep data={baseData as any} updateData={vi.fn()} />);

    const picker = pickerProps.find((props) => String(props.id).startsWith('template-hourly-service-'));
    expect(picker).toBeDefined();
    expect(picker!.billingMethods).toBeUndefined();
    expect(picker!.itemKinds).toEqual(['service']);
  });

  it('offers every service on the usage step', () => {
    render(<TemplateUsageBasedServicesStep data={baseData as any} updateData={vi.fn()} />);

    const picker = pickerProps.find((props) => String(props.id).startsWith('template-usage-service-'));
    expect(picker).toBeDefined();
    expect(picker!.billingMethods).toBeUndefined();
    expect(picker!.itemKinds).toEqual(['service']);
  });
});
