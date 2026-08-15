// @vitest-environment jsdom

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HourlyServicesStep } from '../src/components/billing-dashboard/contracts/wizard-steps/HourlyServicesStep';
import { createDefaultContractWizardData, ContractWizardData } from '../src/components/billing-dashboard/contracts/ContractWizard';

const mocks = vi.hoisted(() => ({
  useFeatureFlag: vi.fn(),
  getBusinessHoursSchedules: vi.fn(),
  getCurrencySymbol: vi.fn(() => '$'),
  translate: vi.fn(),
}));

vi.mock('@alga-psa/ui/hooks', () => ({
  useFeatureFlag: (...args: unknown[]) => mocks.useFeatureFlag(...args),
}));

vi.mock('@alga-psa/sla/actions', () => ({
  getBusinessHoursSchedules: (...args: unknown[]) => mocks.getBusinessHoursSchedules(...args),
}));

vi.mock('@alga-psa/core', () => ({
  getCurrencySymbol: (...args: unknown[]) => mocks.getCurrencySymbol(...args),
}));

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({ t: (...args: unknown[]) => mocks.translate(...args) }),
}));

vi.mock('@alga-psa/billing/hooks/useBillingEnumOptions', () => ({
  useFormatBillingFrequency: () => (value: string) => value,
}));

vi.mock('../src/components/billing-dashboard/contracts/ServiceCatalogPicker', () => ({
  ServiceCatalogPicker: () => <div data-testid="service-picker" />,
}));

vi.mock('../src/components/billing-dashboard/contracts/BucketOverlayFields', () => ({
  BucketOverlayFields: () => <div data-testid="bucket-overlay-fields" />,
}));

vi.mock('../src/components/billing-dashboard/contracts/BillingFrequencyOverrideSelect', () => ({
  BillingFrequencyOverrideSelect: () => <div />,
}));

vi.mock('@alga-psa/ui/components/Input', () => ({
  Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
}));

vi.mock('@alga-psa/ui/components/Label', () => ({
  Label: ({ children, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) => (
    <label {...props}>{children}</label>
  ),
}));

vi.mock('@alga-psa/ui/components/Button', () => ({
  Button: ({ children, ...props }: any) => <button {...props}>{children}</button>,
}));

vi.mock('@alga-psa/ui/components/SwitchWithLabel', () => ({
  SwitchWithLabel: ({ label, checked, onCheckedChange, ...props }: any) => (
    <label>
      <input
        type="checkbox"
        checked={Boolean(checked)}
        onChange={(e) => onCheckedChange?.(e.target.checked)}
        {...props}
      />
      {label}
    </label>
  ),
}));

vi.mock('@alga-psa/ui/components/Alert', () => ({
  Alert: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDescription: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

function renderStep(data: ContractWizardData, updateData: (d: Partial<ContractWizardData>) => void) {
  mocks.translate.mockImplementation(
    (key: string, options?: Record<string, unknown>) => {
      let value = String(options?.defaultValue ?? key);
      for (const [name, replacement] of Object.entries(options ?? {})) {
        value = value.replace(`{{${name}}}`, String(replacement));
      }
      return value;
    },
  );
  return render(<HourlyServicesStep data={data} updateData={updateData} />);
}

describe('ContractWizard pool configuration (flag states)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.useFeatureFlag.mockReturnValue({ enabled: false, loading: false, error: null });
    mocks.getBusinessHoursSchedules.mockResolvedValue([]);
  });

  it('flag-off: preserves the legacy per-service bucket overlay UI and collects no pools', () => {
    const data = createDefaultContractWizardData();
    data.hourly_services = [
      { service_id: 'svc-1', service_name: 'Support', hourly_rate: 10000, bucket_overlay: undefined },
    ];
    const updateData = vi.fn();

    renderStep(data, updateData);

    // Legacy toggle is present (per-service "Set bucket of hours").
    expect(screen.getByText('Set bucket of hours')).not.toBeNull();
    // No flag-on pool editor.
    expect(screen.queryByText('Bucket pools for this line')).toBeNull();
    expect(screen.queryByText('Add Pool')).toBeNull();
  });

  it('flag-on: renders the line-level pool draft editor and surfaces drafts through updateData', async () => {
    mocks.useFeatureFlag.mockReturnValue({ enabled: true, loading: false, error: null });
    mocks.getBusinessHoursSchedules.mockResolvedValue([
      { schedule_id: 'sch-1', schedule_name: 'Standard hours', is_default: true },
    ]);

    const data = createDefaultContractWizardData();
    data.hourly_services = [
      { service_id: 'svc-1', service_name: 'Support', hourly_rate: 10000, bucket_overlay: undefined },
    ];
    const updateData = vi.fn();

    renderStep(data, updateData);

    expect(await screen.findByText('Bucket pools for this line')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Add Pool' }));

    // Fill the create form: 20 hours, 150 $/hr overage, member service svc-1 at 2x.
    fireEvent.change(screen.getByDisplayValue('40'), { target: { value: '20' } });
    fireEvent.change(screen.getByDisplayValue('0'), { target: { value: '150' } });
    fireEvent.change(screen.getByText('Select a service…').closest('select')!, { target: { value: 'svc-1' } });
    fireEvent.change(screen.getByDisplayValue('1'), { target: { value: '2' } });
    fireEvent.click(document.getElementById('add-create-wizard-pool-member-button')!);

    fireEvent.click(screen.getByRole('button', { name: 'Create pool' }));

    await waitFor(() => {
      const calls = updateData.mock.calls;
      const bucketPoolsCall = calls.find((call) => call[0]?.bucket_pools);
      expect(bucketPoolsCall).toBeDefined();
      const pools = bucketPoolsCall![0].bucket_pools;
      expect(pools).toHaveLength(1);
      expect(pools[0]).toMatchObject({
        line_key: 'hourly',
        total_minutes: 1200,
        overage_rate: 15000,
        covers_all_services: false,
        members: [{ service_id: 'svc-1', burn_multiplier: 2 }],
      });
    });
  });
});
