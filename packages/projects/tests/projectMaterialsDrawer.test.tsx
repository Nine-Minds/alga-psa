/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
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

    const toast = await import('react-hot-toast');
    vi.mocked(toast.toast.error).mockClear();
    vi.mocked(toast.toast.success).mockClear();
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

  it('shows Pending and Billed badges based on billing state (T006)', async () => {
    mockMaterials = [
      {
        project_material_id: 'material-1',
        project_id: 'project-1',
        client_id: 'client-1',
        service_id: 'service-1',
        service_name: 'Widget',
        sku: null,
        quantity: 1,
        rate: 2500,
        currency_code: 'USD',
        description: null,
        is_billed: false,
      } as IProjectMaterial,
      {
        project_material_id: 'material-2',
        project_id: 'project-1',
        client_id: 'client-1',
        service_id: 'service-2',
        service_name: 'Gadget',
        sku: null,
        quantity: 1,
        rate: 3500,
        currency_code: 'USD',
        description: null,
        is_billed: true,
      } as IProjectMaterial,
    ];

    const ProjectMaterialsDrawer = (await import('../src/components/ProjectMaterialsDrawer')).default;
    render(<ProjectMaterialsDrawer projectId="project-1" clientId="client-1" />);

    expect(await screen.findByText('Pending')).toBeInTheDocument();
    expect(screen.getByText('Billed')).toBeInTheDocument();
  });

  it('formats currency values from minor units (T007)', async () => {
    mockMaterials = [
      {
        project_material_id: 'material-1',
        project_id: 'project-1',
        client_id: 'client-1',
        service_id: 'service-1',
        service_name: 'Widget',
        sku: null,
        quantity: 3,
        rate: 1234,
        currency_code: 'EUR',
        description: null,
        is_billed: false,
      } as IProjectMaterial,
    ];

    const ProjectMaterialsDrawer = (await import('../src/components/ProjectMaterialsDrawer')).default;
    render(<ProjectMaterialsDrawer projectId="project-1" clientId="client-1" />);

    expect(await screen.findByText(formatCurrencyFromMinorUnits(1234, 'en-US', 'EUR'))).toBeInTheDocument();
    expect(screen.getByText(formatCurrencyFromMinorUnits(3702, 'en-US', 'EUR'))).toBeInTheDocument();
  });

  it('groups unbilled totals by currency (T008)', async () => {
    mockMaterials = [
      {
        project_material_id: 'material-1',
        project_id: 'project-1',
        client_id: 'client-1',
        service_id: 'service-1',
        service_name: 'Widget',
        sku: null,
        quantity: 2,
        rate: 5000,
        currency_code: 'USD',
        description: null,
        is_billed: false,
      } as IProjectMaterial,
      {
        project_material_id: 'material-2',
        project_id: 'project-1',
        client_id: 'client-1',
        service_id: 'service-2',
        service_name: 'Gadget',
        sku: null,
        quantity: 1,
        rate: 1000,
        currency_code: 'EUR',
        description: null,
        is_billed: false,
      } as IProjectMaterial,
      {
        project_material_id: 'material-3',
        project_id: 'project-1',
        client_id: 'client-1',
        service_id: 'service-3',
        service_name: 'Billed Item',
        sku: null,
        quantity: 1,
        rate: 999,
        currency_code: 'USD',
        description: null,
        is_billed: true,
      } as IProjectMaterial,
    ];

    const ProjectMaterialsDrawer = (await import('../src/components/ProjectMaterialsDrawer')).default;
    render(<ProjectMaterialsDrawer projectId="project-1" clientId="client-1" />);

    expect(await screen.findByText('Unbilled (USD):')).toBeInTheDocument();
    expect(screen.getByText('Unbilled (EUR):')).toBeInTheDocument();
    expect(screen.getByText(formatCurrencyFromMinorUnits(10000, 'en-US', 'USD'))).toBeInTheDocument();
    expect(screen.getByText(formatCurrencyFromMinorUnits(1000, 'en-US', 'EUR'))).toBeInTheDocument();
  });

  it('loads product options for the dropdown (T009)', async () => {
    mockProducts = [
      { service_id: 'service-1', service_name: 'Widget', sku: 'W-1' } as CatalogPickerItem,
      { service_id: 'service-2', service_name: 'Gadget', sku: null } as CatalogPickerItem,
    ];

    const actions = await import('@alga-psa/billing/actions');
    const ProjectMaterialsDrawer = (await import('../src/components/ProjectMaterialsDrawer')).default;
    render(<ProjectMaterialsDrawer projectId="project-1" clientId="client-1" />);

    await screen.findByText('Materials');
    await screen.findByRole('button', { name: 'Add' }).then((button) => button.click());

    expect(await screen.findByText('Widget (W-1)')).toBeInTheDocument();
    expect(screen.getByText('Gadget')).toBeInTheDocument();
    expect(actions.searchServiceCatalogForPicker).toHaveBeenCalledWith({
      item_kinds: ['product'],
      is_active: true,
      limit: 100,
    });
  });

  it('shows price selector options after product selection (T010)', async () => {
    mockProducts = [
      { service_id: 'service-1', service_name: 'Widget', sku: 'W-1' } as CatalogPickerItem,
    ];
    mockPrices = [
      { service_id: 'service-1', currency_code: 'USD', rate: 1000 } as IServicePrice,
      { service_id: 'service-1', currency_code: 'EUR', rate: 900 } as IServicePrice,
    ];

    const ProjectMaterialsDrawer = (await import('../src/components/ProjectMaterialsDrawer')).default;
    render(<ProjectMaterialsDrawer projectId="project-1" clientId="client-1" />);

    const addButton = await screen.findByRole('button', { name: 'Add' });
    addButton.click();

    const productSelect = await screen.findByTestId('searchable-select');
    fireEvent.change(productSelect, { target: { value: 'service-1' } });

    const usdLabel = `USD - ${formatCurrencyFromMinorUnits(1000, 'en-US', 'USD')}`;
    const eurLabel = `EUR - ${formatCurrencyFromMinorUnits(900, 'en-US', 'EUR')}`;
    expect(await screen.findByText(usdLabel)).toBeInTheDocument();
    expect(screen.getByText(eurLabel)).toBeInTheDocument();
  });

  it('defaults quantity to 1 and prevents values below 1 (T011)', async () => {
    const ProjectMaterialsDrawer = (await import('../src/components/ProjectMaterialsDrawer')).default;
    render(<ProjectMaterialsDrawer projectId="project-1" clientId="client-1" />);

    const addButton = await screen.findByRole('button', { name: 'Add' });
    addButton.click();

    const quantityInput = await screen.findByLabelText('Quantity');
    expect(quantityInput).toHaveValue(1);

    fireEvent.change(quantityInput, { target: { value: '0' } });
    expect(quantityInput).toHaveValue(1);
  });

  it('updates total when quantity or currency changes (T012)', async () => {
    mockProducts = [
      { service_id: 'service-1', service_name: 'Widget', sku: null } as CatalogPickerItem,
    ];
    mockPrices = [
      { service_id: 'service-1', currency_code: 'USD', rate: 1000 } as IServicePrice,
      { service_id: 'service-1', currency_code: 'EUR', rate: 2000 } as IServicePrice,
    ];

    const ProjectMaterialsDrawer = (await import('../src/components/ProjectMaterialsDrawer')).default;
    render(<ProjectMaterialsDrawer projectId="project-1" clientId="client-1" />);

    const addButton = await screen.findByRole('button', { name: 'Add' });
    addButton.click();

    const productSelect = await screen.findByTestId('searchable-select');
    fireEvent.change(productSelect, { target: { value: 'service-1' } });

    const initialTotal = formatCurrencyFromMinorUnits(1000, 'en-US', 'USD');
    expect(await screen.findByText(initialTotal)).toBeInTheDocument();

    const quantityInput = await screen.findByLabelText('Quantity');
    fireEvent.change(quantityInput, { target: { value: '2' } });

    const updatedTotal = formatCurrencyFromMinorUnits(2000, 'en-US', 'USD');
    expect(await screen.findByText(updatedTotal)).toBeInTheDocument();

    const currencySelect = await screen.findByTestId('project-materials-currency-select');
    fireEvent.change(currencySelect, { target: { value: 'EUR' } });

    const eurTotal = formatCurrencyFromMinorUnits(4000, 'en-US', 'EUR');
    expect(await screen.findByText(eurTotal)).toBeInTheDocument();
  });

  it('adds material and refreshes the list (T013)', async () => {
    mockProducts = [
      { service_id: 'service-1', service_name: 'Widget', sku: null } as CatalogPickerItem,
    ];
    mockPrices = [
      { service_id: 'service-1', currency_code: 'USD', rate: 1500 } as IServicePrice,
    ];

    const actions = await import('@alga-psa/billing/actions');
    const ProjectMaterialsDrawer = (await import('../src/components/ProjectMaterialsDrawer')).default;
    render(<ProjectMaterialsDrawer projectId="project-1" clientId="client-1" />);

    const addButton = await screen.findByRole('button', { name: 'Add' });
    addButton.click();

    const productSelect = await screen.findByTestId('searchable-select');
    fireEvent.change(productSelect, { target: { value: 'service-1' } });

    const quantityInput = await screen.findByLabelText('Quantity');
    fireEvent.change(quantityInput, { target: { value: '2' } });

    const descriptionInput = await screen.findByLabelText('Description (optional)');
    fireEvent.change(descriptionInput, { target: { value: 'Install notes' } });

    const submitButton = await screen.findByRole('button', { name: 'Add Material' });
    submitButton.click();

    await waitFor(() => {
      expect(actions.addProjectMaterial).toHaveBeenCalledWith({
        project_id: 'project-1',
        client_id: 'client-1',
        service_id: 'service-1',
        quantity: 2,
        rate: 1500,
        currency_code: 'USD',
        description: 'Install notes',
      });
    });

    await waitFor(() => {
      expect(actions.listProjectMaterials).toHaveBeenCalledTimes(2);
    });
  });

  it('shows validation errors for missing product or price (T014)', async () => {
    mockProducts = [
      { service_id: 'service-1', service_name: 'Widget', sku: null } as CatalogPickerItem,
    ];
    mockPrices = [];

    const toast = await import('react-hot-toast');
    const ProjectMaterialsDrawer = (await import('../src/components/ProjectMaterialsDrawer')).default;
    render(<ProjectMaterialsDrawer projectId="project-1" clientId="client-1" />);

    const addButton = await screen.findByRole('button', { name: 'Add' });
    addButton.click();

    const submitButton = await screen.findByRole('button', { name: 'Add Material' });
    submitButton.removeAttribute('disabled');
    submitButton.click();

    expect(toast.toast.error).toHaveBeenCalledWith('Please select a product');

    const productSelect = await screen.findByTestId('searchable-select');
    fireEvent.change(productSelect, { target: { value: 'service-1' } });

    submitButton.removeAttribute('disabled');
    submitButton.click();

    expect(toast.toast.error).toHaveBeenCalledWith('Please select a currency');
  });

  it('only shows delete button for unbilled materials (T015)', async () => {
    mockMaterials = [
      {
        project_material_id: 'material-1',
        project_id: 'project-1',
        client_id: 'client-1',
        service_id: 'service-1',
        service_name: 'Widget',
        sku: null,
        quantity: 1,
        rate: 1000,
        currency_code: 'USD',
        description: null,
        is_billed: false,
      } as IProjectMaterial,
      {
        project_material_id: 'material-2',
        project_id: 'project-1',
        client_id: 'client-1',
        service_id: 'service-2',
        service_name: 'Gadget',
        sku: null,
        quantity: 1,
        rate: 2000,
        currency_code: 'USD',
        description: null,
        is_billed: true,
      } as IProjectMaterial,
    ];

    const ProjectMaterialsDrawer = (await import('../src/components/ProjectMaterialsDrawer')).default;
    const { container } = render(<ProjectMaterialsDrawer projectId="project-1" clientId="client-1" />);

    await screen.findByText('Widget');

    expect(
      container.querySelector('[data-automation-id="project-materials-drawer-delete-material-1"]')
    ).toBeInTheDocument();
    expect(
      container.querySelector('[data-automation-id="project-materials-drawer-delete-material-2"]')
    ).toBeNull();
  });

  it('deletes material and refreshes the list (T016)', async () => {
    mockMaterials = [
      {
        project_material_id: 'material-1',
        project_id: 'project-1',
        client_id: 'client-1',
        service_id: 'service-1',
        service_name: 'Widget',
        sku: null,
        quantity: 1,
        rate: 1000,
        currency_code: 'USD',
        description: null,
        is_billed: false,
      } as IProjectMaterial,
    ];

    const actions = await import('@alga-psa/billing/actions');
    const ProjectMaterialsDrawer = (await import('../src/components/ProjectMaterialsDrawer')).default;
    const { container } = render(<ProjectMaterialsDrawer projectId="project-1" clientId="client-1" />);

    await screen.findByText('Widget');

    const deleteButton = container.querySelector(
      '[data-automation-id="project-materials-drawer-delete-material-1"]'
    ) as HTMLButtonElement;
    deleteButton.click();

    await waitFor(() => {
      expect(actions.deleteProjectMaterial).toHaveBeenCalledWith('material-1');
    });

    await waitFor(() => {
      expect(actions.listProjectMaterials).toHaveBeenCalledTimes(2);
    });
  });
});
