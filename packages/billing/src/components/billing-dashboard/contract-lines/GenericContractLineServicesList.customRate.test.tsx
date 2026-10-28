/**
 * @vitest-environment jsdom
 *
 * Regression for #3697: the Custom Rate column multiplied the stored rate by
 * 100 before formatting, so a service stored as 7000 minor units rendered as
 * €7,000.00. custom_rate and the default_rate fallback are both minor units.
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';

const actions = vi.hoisted(() => ({
  getContractLineServicesWithConfigurations: vi.fn(),
  addServiceToContractLine: vi.fn(),
  removeServiceFromContractLine: vi.fn(),
  getServices: vi.fn(),
  getContractLineById: vi.fn(),
  getContractById: vi.fn(),
  getServiceCategories: vi.fn(),
}));

vi.mock('@alga-psa/billing/actions/contractLineServiceActions', () => ({
  getContractLineServicesWithConfigurations: actions.getContractLineServicesWithConfigurations,
  addServiceToContractLine: actions.addServiceToContractLine,
  removeServiceFromContractLine: actions.removeServiceFromContractLine,
}));
vi.mock('@alga-psa/billing/actions/serviceActions', () => ({
  getServices: actions.getServices,
}));
vi.mock('@alga-psa/billing/actions/contractLineAction', () => ({
  getContractLineById: actions.getContractLineById,
}));
vi.mock('@alga-psa/billing/actions/contractActions', () => ({
  getContractById: actions.getContractById,
}));
vi.mock('@alga-psa/billing/actions/categoryActions', () => ({
  getServiceCategories: actions.getServiceCategories,
}));
vi.mock('./ContractLineServiceForm', () => ({ default: () => null }));

// Stable `t` identity: the component's fetchData useCallback depends on it.
const stableT = (key: string, options?: Record<string, unknown>) => {
  let text = String(options?.defaultValue ?? key);
  for (const [name, value] of Object.entries(options ?? {})) {
    if (name === 'defaultValue') continue;
    text = text.replace(`{{${name}}}`, String(value));
  }
  return text;
};
const stableTranslation = { t: stableT };

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => stableTranslation,
  useOptionalI18n: () => null,
}));

// Deterministic table harness: renders the real column renderers so the
// Custom Rate formatting under test is what gets asserted.
vi.mock('@alga-psa/ui/components/DataTable', () => ({
  DataTable: ({
    data,
    columns,
  }: {
    data: Array<Record<string, unknown>>;
    columns: Array<{
      dataIndex: string;
      render?: (value: unknown, record: Record<string, unknown>) => React.ReactNode;
    }>;
  }) => (
    <table>
      <tbody>
        {data.map((row, rowIndex) => (
          <tr key={String(row.service_id)}>
            {columns.map((column, columnIndex) => (
              <td key={columnIndex} data-testid={`cell-${rowIndex}-${column.dataIndex}`}>
                {column.render
                  ? column.render(row[column.dataIndex], row)
                  : String(row[column.dataIndex] ?? '')}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  ),
}));

import { CurrencyFormatProvider } from '@alga-psa/ui/lib';
import GenericContractLineServicesList from './GenericContractLineServicesList';

const serviceConfigs = [
  {
    configuration: {
      service_id: 'svc-custom',
      configuration_type: 'Hourly',
      quantity: 1,
      custom_rate: 7000,
    },
    service: {
      service_id: 'svc-custom',
      service_name: 'Senior Engineer',
      service_type_name: 'Support',
      billing_method: 'hourly',
      unit_of_measure: 'hour',
      default_rate: 7000,
    },
    typeConfig: { hourly_rate: 7000 },
  },
  {
    configuration: {
      service_id: 'svc-standard',
      configuration_type: 'Hourly',
      quantity: 1,
      // custom_rate is a nullable numeric column, so a row with no custom rate
      // comes back as null; the column falls back to the catalog default_rate.
      custom_rate: null,
    },
    service: {
      service_id: 'svc-standard',
      service_name: 'Project Manager',
      service_type_name: 'Support',
      billing_method: 'hourly',
      unit_of_measure: 'hour',
      default_rate: 10000,
    },
    typeConfig: null,
  },
  {
    configuration: {
      service_id: 'svc-absent',
      configuration_type: 'Hourly',
      quantity: 1,
      // Key absent entirely: same fallback as an explicit null.
    },
    service: {
      service_id: 'svc-absent',
      service_name: 'Field Technician',
      service_type_name: 'Support',
      billing_method: 'hourly',
      unit_of_measure: 'hour',
      default_rate: 10000,
    },
    typeConfig: null,
  },
];

const renderList = () =>
  render(
    <CurrencyFormatProvider currencyCode="EUR" locale="en-US">
      <GenericContractLineServicesList contractLineId="line-1" />
    </CurrencyFormatProvider>,
  );

describe('GenericContractLineServicesList custom rate formatting', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    actions.getContractLineById.mockResolvedValue({
      contract_line_id: 'line-1',
      contract_id: 'contract-1',
      contract_line_type: 'Hourly',
      billing_frequency: 'monthly',
    });
    actions.getContractById.mockResolvedValue({
      contract_id: 'contract-1',
      currency_code: 'EUR',
    });
    actions.getContractLineServicesWithConfigurations.mockResolvedValue(serviceConfigs);
    actions.getServices.mockResolvedValue({ services: [], totalCount: 0 });
    actions.getServiceCategories.mockResolvedValue([]);
  });

  afterEach(() => cleanup());

  it('renders a stored custom_rate of 7000 minor units as €70.00', async () => {
    renderList();

    const cell = await screen.findByTestId('cell-0-custom_rate');
    expect(cell).toHaveTextContent('Custom');
    expect(cell).toHaveTextContent('€70.00');
    expect(cell.textContent).not.toContain('7,000.00');
  });

  it('falls back to default_rate when custom_rate is null, not N/A', async () => {
    renderList();

    const cell = await screen.findByTestId('cell-1-custom_rate');
    expect(cell).toHaveTextContent('Standard');
    expect(cell).toHaveTextContent('€100.00');
    expect(cell.textContent).not.toContain('N/A');
    expect(cell.textContent).not.toContain('10,000.00');
  });

  it('renders the default_rate fallback when custom_rate is absent', async () => {
    renderList();

    const cell = await screen.findByTestId('cell-2-custom_rate');
    expect(cell).toHaveTextContent('Standard');
    expect(cell).toHaveTextContent('€100.00');
  });

  it('handles the numeric string Postgres returns for custom_rate', async () => {
    actions.getContractLineServicesWithConfigurations.mockResolvedValue([
      {
        ...serviceConfigs[0],
        configuration: { ...serviceConfigs[0].configuration, custom_rate: '7000.00' },
      },
    ]);

    renderList();

    const cell = await screen.findByTestId('cell-0-custom_rate');
    expect(cell).toHaveTextContent('€70.00');
  });

  it('never inflates either rate by 100 anywhere in the table', async () => {
    renderList();

    await screen.findByTestId('cell-0-custom_rate');
    expect(screen.queryByText(/€7,000\.00/)).not.toBeInTheDocument();
    expect(screen.queryByText(/€10,000\.00/)).not.toBeInTheDocument();
  });
});
