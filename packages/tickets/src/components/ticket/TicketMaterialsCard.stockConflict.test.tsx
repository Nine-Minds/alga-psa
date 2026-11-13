/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { configure, render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react';
import type { IServicePrice } from '@alga-psa/types';
import useSWR, { SWRConfig } from 'swr';
import { entityAssetsCacheKey } from '@alga-psa/core/assetCacheKeys';
import TicketMaterialsCard from './TicketMaterialsCard';

configure({ asyncUtilTimeout: 5000 });

// B1: the ticket materials card shows a refusal or an override prompt from the structured
// stockConflict result the add action returns.

let mockProducts: any[] = [];
let mockPrices: IServicePrice[] = [];

vi.mock('@alga-psa/ui/lib/i18n/client', async (importOriginal) => {
  const actual: any = await importOriginal();
  const t = (key: string, options?: unknown, params?: Record<string, unknown>) => {
    const template = typeof options === 'string' ? options : ((options as any)?.defaultValue ?? key);
    const vars = typeof options === 'string' ? params : (options as Record<string, unknown> | undefined);
    return template.replace(/\{\{(\w+)\}\}/g, (m: string, n: string) => (vars?.[n] === undefined ? m : String(vars[n])));
  };
  const translation = { t, i18n: { language: 'en' } };
  return { ...actual, useTranslation: () => translation };
});

vi.mock('react-hot-toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

vi.mock('@alga-psa/ui/components/AsyncSearchableSelect', () => {
  const React = (require("react") as typeof import("react"));
  function MockSelect({ value, onChange, loadOptions, placeholder, limit }: any) {
    const [options, setOptions] = React.useState<any[]>([]);
    React.useEffect(() => {
      loadOptions({ search: '', page: 1, limit: limit ?? 10 }).then((r: any) => setOptions(r.options));
    }, [loadOptions, limit]);
    return (
      <select data-testid="async-searchable-select" value={value} onChange={(e: any) => onChange(e.target.value, options.find((o: any) => o.value === e.target.value))}>
        <option value="">{placeholder}</option>
        {options.map((o: any) => (
          <option key={o.value} value={o.value}>{o.label}{o.badge ? ` [${o.badge.text}]` : ''}</option>
        ))}
      </select>
    );
  }
  return { default: MockSelect, __esModule: true };
});

vi.mock('@alga-psa/ui/components/CustomSelect', () => ({
  default: ({ options, value, onValueChange, placeholder, id }: any) => (
    <select data-testid={id || 'custom-select'} value={value} onChange={(e) => onValueChange(e.target.value)}>
      <option value="">{placeholder}</option>
      {options.map((o: any) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  ),
}));

vi.mock('@alga-psa/ui/ui-reflection/useAutomationIdAndRegister', () => ({
  useAutomationIdAndRegister: (config: any, _a: any, dataAutomationId?: string) => ({
    automationIdProps: {
      ...(config?.id ? { id: config.id } : {}),
      ...(dataAutomationId || config?.id ? { 'data-automation-id': dataAutomationId ?? config.id } : {}),
    },
    updateMetadata: vi.fn(),
  }),
}));

vi.mock('@alga-psa/inventory/actions/availabilityActions', () => ({
  getProductAvailability: vi.fn(async () => []),
}));

vi.mock('../../actions/materialCatalogActions', () => ({
  listTicketMaterials: vi.fn(async () => []),
  searchServiceCatalogForPicker: vi.fn(async () => ({ items: mockProducts, totalCount: mockProducts.length })),
  getServicePrices: vi.fn(async () => mockPrices),
  addTicketMaterial: vi.fn(async () => undefined),
  deleteTicketMaterial: vi.fn(async () => undefined),
  listAvailableStockUnitsForMaterial: vi.fn(async () => []),
  updateTicketMaterial: vi.fn(async () => undefined),
  getTicketCatalogCategories: vi.fn(async () => []),
}));

vi.mock('./TicketDataSourceContext', async () => {
  const materials = await import('../../actions/materialCatalogActions');
  const availability = await import('@alga-psa/inventory/actions/availabilityActions');
  return {
    useTicketScreenReadOnly: () => false,
    useTicketDataSource: () => ({ materials: { ...materials, ...availability } }),
  };
});

const conflict = (overrides: Record<string, unknown>) => ({
  stockConflict: {
    reason: 'reserved', overrideable: true, free: 2, onHand: 10, reserved: 8, held: 0, requested: 5,
    message: 'server fallback', ...overrides,
  },
});

async function openFormAndSubmit() {
  render(<TicketMaterialsCard ticketId="ticket-1" clientId="client-1" />);
  fireEvent.click(await screen.findByRole('button', { name: 'Add Material' }));
  fireEvent.change(await screen.findByTestId('async-searchable-select'), { target: { value: 'service-1' } });
  fireEvent.change(await screen.findByLabelText('Quantity'), { target: { value: '5' } });
  const submit = await screen.findAllByRole('button', { name: 'Add Material' });
  fireEvent.click(submit[submit.length - 1]);
}

describe('TicketMaterialsCard stock reserved or held for sales orders (B1)', () => {
  afterEach(cleanup);
  beforeEach(async () => {
    cleanup();
    mockProducts = [{ service_id: 'service-1', service_name: 'Widget', sku: null, track_stock: true, free_total: 2, on_hand_total: 10 }];
    mockPrices = [{ service_id: 'service-1', currency_code: 'USD', rate: 1500 } as IServicePrice];
    const actions = await import('../../actions/materialCatalogActions');
    vi.mocked(actions.addTicketMaterial).mockReset();
    vi.mocked(actions.listTicketMaterials).mockResolvedValue([]);
    vi.mocked(actions.listAvailableStockUnitsForMaterial).mockResolvedValue([]);
    const availability = await import('@alga-psa/inventory/actions/availabilityActions');
    vi.mocked(availability.getProductAvailability).mockResolvedValue([]);
  });

  it('picker badge shows free stock, not on-hand', async () => {
    render(<TicketMaterialsCard ticketId="ticket-1" clientId="client-1" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Add Material' }));
    expect(await screen.findByText(/Widget \[Available: 2\]/)).toBeInTheDocument();
  });

  it('soft reservation: asks to confirm, then retries with the override', async () => {
    const actions = await import('../../actions/materialCatalogActions');
    vi.mocked(actions.addTicketMaterial)
      .mockResolvedValueOnce(conflict({}) as any)
      .mockResolvedValueOnce({ ticket_material_id: 'm-new' } as any);

    await openFormAndSubmit();

    expect(await screen.findByText('Stock is reserved for a sales order or project')).toBeInTheDocument();
    expect(screen.getByText(/Only 2 of this product is free\. 8 on hand is reserved for sales orders or projects, and you asked for 5/)).toBeInTheDocument();
    expect(vi.mocked(actions.addTicketMaterial).mock.calls[0][0]).not.toHaveProperty('allow_reserved_override');

    fireEvent.click(screen.getByRole('button', { name: 'Add anyway' }));
    await waitFor(() => expect(actions.addTicketMaterial).toHaveBeenCalledTimes(2));
    expect(vi.mocked(actions.addTicketMaterial).mock.calls[1][0]).toMatchObject({ service_id: 'service-1', quantity: 5, allow_reserved_override: true });
  });

  it('hard hold: shows a non-overrideable error naming the free quantity, no override offered', async () => {
    const actions = await import('../../actions/materialCatalogActions');
    vi.mocked(actions.addTicketMaterial).mockResolvedValueOnce(conflict({ reason: 'held', overrideable: false, free: 3, held: 7 }) as any);

    await openFormAndSubmit();

    expect(await screen.findByText(/Only 3 available\. 7 on hand is on hard hold for sales orders or projects/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add anyway' })).not.toBeInTheDocument();
    expect(actions.addTicketMaterial).toHaveBeenCalledTimes(1);
  });

  it('locks serialized add quantity to one even when availability arrives after quantity was entered', async () => {
    const actions = await import('../../actions/materialCatalogActions');
    const availability = await import('@alga-psa/inventory/actions/availabilityActions');
    vi.mocked(availability.getProductAvailability).mockResolvedValue([{
      service_id: 'service-1', is_serialized: true, track_stock: true,
      on_hand_total: 1, available_total: 1, reorder_point: null, locations: [],
    }]);
    vi.mocked(actions.listAvailableStockUnitsForMaterial).mockResolvedValue([{
      unit_id: 'unit-1', serial_number: 'SERIAL-1',
    } as import('@alga-psa/types').IStockUnit]);
    render(<TicketMaterialsCard ticketId="ticket-1" clientId="client-1" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Add Material' }));
    fireEvent.change(screen.getByLabelText('Quantity'), { target: { value: '5' } });
    fireEvent.change(await screen.findByTestId('async-searchable-select'), { target: { value: 'service-1' } });
    await waitFor(() => {
      expect(screen.getByLabelText('Quantity')).toBeDisabled();
      expect(screen.getByLabelText('Quantity')).toHaveValue(1);
    });
    fireEvent.change(await screen.findByTestId('ticket-materials-card-unit-select'), { target: { value: 'unit-1' } });
    const submit = screen.getAllByRole('button', { name: 'Add Material' });
    fireEvent.click(submit[submit.length - 1]);
    await waitFor(() => expect(actions.addTicketMaterial).toHaveBeenCalledWith(
      expect.objectContaining({ quantity: 1, unit_id: 'unit-1' }),
    ));
  });

  it('refreshes the mounted asset list in the same add operation without refreshing the page', async () => {
    const actions = await import('../../actions/materialCatalogActions');
    let assets: string[] = [];
    const loadAssets = vi.fn(async () => assets);
    function AssetsCard() {
      const { data = [] } = useSWR(entityAssetsCacheKey('ticket', 'ticket-1'), loadAssets);
      return <div data-testid="linked-assets">{data.join(',')}</div>;
    }
    vi.mocked(actions.addTicketMaterial).mockImplementation(async () => {
      assets = ['SERIAL-1'];
      return { ticket_material_id: 'material-1' } as import('@alga-psa/types').ITicketMaterial;
    });
    render(<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <AssetsCard />
      <TicketMaterialsCard ticketId="ticket-1" clientId="client-1" />
    </SWRConfig>);
    await waitFor(() => expect(loadAssets).toHaveBeenCalledOnce());
    fireEvent.click(await screen.findByRole('button', { name: 'Add Material' }));
    fireEvent.change(await screen.findByTestId('async-searchable-select'), { target: { value: 'service-1' } });
    await waitFor(() => expect(document.getElementById('ticket-materials-card-save-add-btn')).not.toBeDisabled());
    const submit = screen.getAllByRole('button', { name: 'Add Material' });
    fireEvent.click(submit[submit.length - 1]);
    await waitFor(() => expect(screen.getByTestId('linked-assets')).toHaveTextContent('SERIAL-1'));
    expect(loadAssets).toHaveBeenCalledTimes(2);
  });
});
