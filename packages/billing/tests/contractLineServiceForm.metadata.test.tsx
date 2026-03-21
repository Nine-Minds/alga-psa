/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

const mockGetContractLineById = vi.fn(async () => ({
  contract_line_type: 'Hourly',
  billing_frequency: 'monthly',
}));
const mockGetConfigurationForService = vi.fn(async () => null);

vi.mock('@alga-psa/billing/actions/contractLineAction', () => ({
  getContractLineById: mockGetContractLineById,
  updateContractLineFixedConfig: vi.fn(async () => undefined),
}));

vi.mock('@alga-psa/billing/actions/contractLineServiceActions', () => ({
  updateContractLineService: vi.fn(async () => undefined),
}));

vi.mock('@alga-psa/billing/actions/contractLineServiceConfigurationActions', () => ({
  getConfigurationForService: mockGetConfigurationForService,
  getConfigurationWithDetails: vi.fn(async () => null),
}));

vi.mock('@alga-psa/billing/actions/bucketOverlayActions', () => ({
  getBucketOverlay: vi.fn(async () => null),
  upsertBucketOverlay: vi.fn(async () => undefined),
  deleteBucketOverlay: vi.fn(async () => undefined),
}));

vi.mock('@alga-psa/ui/components/providers/TenantProvider', () => ({
  useTenant: () => 'tenant-test',
}));

vi.mock('@alga-psa/ui/components/Dialog', () => ({
  Dialog: ({ children }: any) => <div>{children}</div>,
  DialogContent: ({ children }: any) => <div>{children}</div>,
}));

vi.mock('../src/components/billing-dashboard/service-configurations/ServiceConfigurationPanel', () => ({
  ServiceConfigurationPanel: ({ effectiveMode, defaultSource }: { effectiveMode: string; defaultSource: string }) => (
    <div>
      <p data-testid="effective-mode">{effectiveMode}</p>
      <p data-testid="default-source">{defaultSource}</p>
    </div>
  ),
}));

describe('ContractLineServiceForm metadata', () => {
  it('T025: shows effective mode from contract-line context and catalog default source label', async () => {
    const ContractLineServiceForm = (await import('../src/components/billing-dashboard/contract-lines/ContractLineServiceForm')).default;

    render(
      <ContractLineServiceForm
        planService={{
          contract_line_id: 'line-1',
          service_id: 'service-1',
          quantity: 1,
          custom_rate: null,
        } as any}
        services={[
          {
            service_id: 'service-1',
            service_name: 'Service One',
            default_rate: 150,
            billing_method: 'fixed',
          } as any,
        ]}
        onClose={() => undefined}
        onServiceUpdated={() => undefined}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId('effective-mode')).toHaveTextContent('Hourly');
      expect(screen.getByTestId('default-source')).toHaveTextContent('catalog default');
    });
  });

  it('shows default source as contract override when custom_rate is set', async () => {
    const ContractLineServiceForm = (await import('../src/components/billing-dashboard/contract-lines/ContractLineServiceForm')).default;

    render(
      <ContractLineServiceForm
        planService={{
          contract_line_id: 'line-2',
          service_id: 'service-2',
          quantity: 1,
          custom_rate: 275,
        } as any}
        services={[
          {
            service_id: 'service-2',
            service_name: 'Service Two',
            default_rate: 150,
            billing_method: 'usage',
          } as any,
        ]}
        onClose={() => undefined}
        onServiceUpdated={() => undefined}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId('default-source')).toHaveTextContent('contract override');
    });
  });

  it('shows default source as none when neither custom nor catalog defaults are present', async () => {
    const ContractLineServiceForm = (await import('../src/components/billing-dashboard/contract-lines/ContractLineServiceForm')).default;

    render(
      <ContractLineServiceForm
        planService={{
          contract_line_id: 'line-3',
          service_id: 'service-3',
          quantity: 1,
          custom_rate: null,
        } as any}
        services={[
          {
            service_id: 'service-3',
            service_name: 'Service Three',
            default_rate: null,
            billing_method: 'hourly',
          } as any,
        ]}
        onClose={() => undefined}
        onServiceUpdated={() => undefined}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId('default-source')).toHaveTextContent('none');
    });
  });
});

