/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import type { IProjectMaterial, IServicePrice } from '@alga-psa/types';
import type { CatalogPickerItem } from '@alga-psa/billing/actions';
import { formatCurrencyFromMinorUnits } from '@alga-psa/core';

let mockMaterials: IProjectMaterial[] = [];
let mockProducts: CatalogPickerItem[] = [];
let mockPrices: IServicePrice[] = [];

vi.mock('react-hot-toast', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('@alga-psa/ui/components/SearchableSelect', () => ({
  default: ({ options, value, onChange, placeholder }: any) => (
    <select
      data-testid="searchable-select"
      value={value}
      onChange={(event) => onChange(event.target.value)}
    >
      <option value="">{placeholder}</option>
      {options.map((option: any) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  ),
}));

vi.mock('@alga-psa/ui/components/CustomSelect', () => ({
  default: ({ options, value, onValueChange, placeholder, id }: any) => (
    <select
      data-testid={id || 'custom-select'}
      value={value}
      onChange={(event) => onValueChange(event.target.value)}
    >
      <option value="">{placeholder}</option>
      {options.map((option: any) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  ),
}));

vi.mock('@alga-psa/billing/actions', () => ({
  listProjectMaterials: vi.fn(async () => mockMaterials),
  searchServiceCatalogForPicker: vi.fn(async () => ({ items: mockProducts })),
  getServicePrices: vi.fn(async () => mockPrices),
  addProjectMaterial: vi.fn(async () => undefined),
  deleteProjectMaterial: vi.fn(async () => undefined),
}));

describe('ProjectMaterialsDrawer', () => {
  beforeEach(async () => {
    mockMaterials = [];
    mockProducts = [];
    mockPrices = [];

    const actions = await import('@alga-psa/billing/actions');
    vi.mocked(actions.listProjectMaterials).mockClear();
    vi.mocked(actions.listProjectMaterials).mockImplementation(async () => mockMaterials);
    vi.mocked(actions.searchServiceCatalogForPicker).mockClear();
    vi.mocked(actions.searchServiceCatalogForPicker).mockImplementation(async () => ({ items: mockProducts }));
    vi.mocked(actions.getServicePrices).mockClear();
    vi.mocked(actions.getServicePrices).mockImplementation(async () => mockPrices);
    vi.mocked(actions.addProjectMaterial).mockClear();
    vi.mocked(actions.deleteProjectMaterial).mockClear();
  });

  it('shows loading state while materials are fetched (T003)', async () => {
    const actions = await import('@alga-psa/billing/actions');
    let resolveMaterials: (value: IProjectMaterial[]) => void = () => undefined;
    const pending = new Promise<IProjectMaterial[]>((resolve) => {
      resolveMaterials = resolve;
    });

    vi.mocked(actions.listProjectMaterials).mockReturnValueOnce(pending);

    const ProjectMaterialsDrawer = (await import('../src/components/ProjectMaterialsDrawer')).default;
    render(<ProjectMaterialsDrawer projectId="project-1" clientId="client-1" />);

    expect(screen.getByText('Loading materials...')).toBeInTheDocument();

    resolveMaterials([]);
    await waitFor(() => {
      expect(screen.getByText('No materials added to this project.')).toBeInTheDocument();
    });
  });

  it('shows empty state when no materials exist (T004)', async () => {
    mockMaterials = [];

    const ProjectMaterialsDrawer = (await import('../src/components/ProjectMaterialsDrawer')).default;
    render(<ProjectMaterialsDrawer projectId="project-1" clientId="client-1" />);

    expect(await screen.findByText('No materials added to this project.')).toBeInTheDocument();
  });

  it('renders table columns and material data (T005)', async () => {
    mockMaterials = [
      {
        project_material_id: 'material-1',
        project_id: 'project-1',
        client_id: 'client-1',
        service_id: 'service-1',
        service_name: 'Widget',
        sku: 'W-100',
        quantity: 2,
        rate: 5000,
        currency_code: 'USD',
        description: null,
        is_billed: false,
      } as IProjectMaterial,
    ];

    const ProjectMaterialsDrawer = (await import('../src/components/ProjectMaterialsDrawer')).default;
    render(<ProjectMaterialsDrawer projectId="project-1" clientId="client-1" />);

    expect(await screen.findByText('Product')).toBeInTheDocument();
    expect(screen.getByText('Qty')).toBeInTheDocument();
    expect(screen.getByText('Rate')).toBeInTheDocument();
    expect(screen.getByText('Total')).toBeInTheDocument();
    expect(screen.getByText('Status')).toBeInTheDocument();

    expect(screen.getByText('Widget')).toBeInTheDocument();
    expect(screen.getByText('(W-100)')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText(formatCurrencyFromMinorUnits(5000, 'en-US', 'USD'))).toBeInTheDocument();
    expect(screen.getByText(formatCurrencyFromMinorUnits(10000, 'en-US', 'USD'))).toBeInTheDocument();
  });
});
