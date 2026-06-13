// @vitest-environment jsdom
/**
 * T208 — HuduAssetLayoutMapManager component (layout-type-config group).
 *
 * jsdom + @testing-library, mirroring huduIntegrationSettings.component.test:
 * the layout-map server actions, UI primitives, and i18n are mocked
 * (CustomSelect as a native <select>); assertions run against the DOM.
 */
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import HuduAssetLayoutMapManager from '@ee/components/settings/integrations/hudu/HuduAssetLayoutMapManager';

const { getHuduAssetLayoutMapMock, setHuduAssetLayoutMapMock, createAssetTypeFromHuduLayoutMock } =
  vi.hoisted(() => ({
    getHuduAssetLayoutMapMock: vi.fn(),
    setHuduAssetLayoutMapMock: vi.fn(),
    createAssetTypeFromHuduLayoutMock: vi.fn(),
  }));

vi.mock('@ee/lib/actions/integrations/huduLayoutMapActions', () => ({
  getHuduAssetLayoutMap: getHuduAssetLayoutMapMock,
  setHuduAssetLayoutMap: setHuduAssetLayoutMapMock,
  createAssetTypeFromHuduLayout: createAssetTypeFromHuduLayoutMock,
}));

vi.mock('@alga-psa/ui/lib/i18n/client', () => {
  const t = (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key;
  return { useTranslation: () => ({ t }) };
});

vi.mock('@alga-psa/ui/components/Card', () => ({
  Card: ({ children, id }: { children: React.ReactNode; id?: string }) => <div id={id}>{children}</div>,
  CardHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CardTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
  CardDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
  CardContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@alga-psa/ui/components/Button', () => ({
  Button: ({ children, id, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { id?: string }) => (
    <button id={id} {...props}>
      {children}
    </button>
  ),
}));

vi.mock('@alga-psa/ui/components/Alert', () => ({
  Alert: ({ children, id, variant }: { children: React.ReactNode; id?: string; variant?: string }) => (
    <div id={id} role="alert" data-variant={variant}>
      {children}
    </div>
  ),
  AlertDescription: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@alga-psa/ui/components/CustomSelect', () => ({
  default: ({
    id,
    options,
    value,
    onValueChange,
    disabled,
  }: {
    id?: string;
    options: Array<{ value: string; label: string }>;
    value?: string | null;
    onValueChange: (value: string) => void;
    disabled?: boolean;
  }) => (
    <select
      id={id}
      data-testid={id}
      value={value ?? ''}
      onChange={(event) => onValueChange(event.target.value)}
      disabled={disabled}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  ),
}));

const layoutsData = {
  layouts: [
    { id: 7, name: 'Computer Assets', suggestedType: 'workstation', configuredType: null },
    { id: 9, name: 'Databases', suggestedType: 'unknown', configuredType: 'server' },
  ],
  map: { '9': 'server' },
};

// F315: registry-backed payload variant (built-ins + a custom type).
const registryTypes = [
  { slug: 'workstation', name: 'Workstation', is_builtin: true },
  { slug: 'server', name: 'Server', is_builtin: true },
  { slug: 'unknown', name: 'Unknown', is_builtin: true },
  { slug: 'firewall_rules', name: 'Firewall Rules', is_builtin: false },
];
const layoutsDataWithTypes = { ...layoutsData, types: registryTypes };

describe('HuduAssetLayoutMapManager', () => {
  beforeEach(() => {
    getHuduAssetLayoutMapMock.mockReset();
    setHuduAssetLayoutMapMock.mockReset();
    createAssetTypeFromHuduLayoutMock.mockReset();
    getHuduAssetLayoutMapMock.mockResolvedValue({ success: true, data: layoutsData });
  });

  it('T208: renders one row per layout with configured ?? heuristic prefill', async () => {
    render(<HuduAssetLayoutMapManager />);

    await screen.findByText('Computer Assets');
    expect(screen.getByText('Databases')).toBeTruthy();

    // Unconfigured layout prefills the heuristic suggestion...
    const computerSelect = screen.getByTestId('hudu-layout-type-select-7') as HTMLSelectElement;
    expect(computerSelect.value).toBe('workstation');
    // ...and shows the suggestion hint; configured layouts show none.
    expect(document.getElementById('hudu-layout-suggestion-7')?.textContent).toContain('Workstation');
    expect(document.getElementById('hudu-layout-suggestion-9')).toBeNull();

    // Configured layout prefills the stored type over the suggestion.
    const databasesSelect = screen.getByTestId('hudu-layout-type-select-9') as HTMLSelectElement;
    expect(databasesSelect.value).toBe('server');
  });

  it('T208: changing a select and clicking Save persists the full map and shows success', async () => {
    setHuduAssetLayoutMapMock.mockResolvedValue({
      success: true,
      data: { map: { '7': 'server', '9': 'server' } },
    });

    render(<HuduAssetLayoutMapManager />);
    await screen.findByText('Computer Assets');

    fireEvent.change(screen.getByTestId('hudu-layout-type-select-7'), { target: { value: 'server' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save layout map' }));

    await waitFor(() => {
      expect(setHuduAssetLayoutMapMock).toHaveBeenCalledTimes(1);
    });
    expect(setHuduAssetLayoutMapMock).toHaveBeenCalledWith({ '7': 'server', '9': 'server' });

    await screen.findByText('Asset layout map saved.');
  });

  it("T258: every row's select offers Don't import and Save persists 'excluded'", async () => {
    setHuduAssetLayoutMapMock.mockResolvedValue({
      success: true,
      data: { map: { '7': 'excluded', '9': 'server' } },
    });

    render(<HuduAssetLayoutMapManager />);
    await screen.findByText('Computer Assets');

    const computerSelect = screen.getByTestId('hudu-layout-type-select-7') as HTMLSelectElement;
    const excludeOption = Array.from(computerSelect.options).find((o) => o.value === 'excluded');
    expect(excludeOption?.textContent).toBe("Don't import");

    fireEvent.change(computerSelect, { target: { value: 'excluded' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save layout map' }));

    await waitFor(() => {
      expect(setHuduAssetLayoutMapMock).toHaveBeenCalledTimes(1);
    });
    expect(setHuduAssetLayoutMapMock).toHaveBeenCalledWith({ '7': 'excluded', '9': 'server' });
    await screen.findByText('Asset layout map saved.');
  });

  it("T258: a stored 'excluded' assignment prefills the select", async () => {
    getHuduAssetLayoutMapMock.mockResolvedValue({
      success: true,
      data: {
        layouts: [{ id: 7, name: 'API Secrets', suggestedType: 'unknown', configuredType: 'excluded' }],
        map: { '7': 'excluded' },
      },
    });

    render(<HuduAssetLayoutMapManager />);
    await screen.findByText('API Secrets');

    expect((screen.getByTestId('hudu-layout-type-select-7') as HTMLSelectElement).value).toBe('excluded');
  });

  it('T208: a save failure surfaces the error alert', async () => {
    setHuduAssetLayoutMapMock.mockResolvedValue({ success: false, error: 'boom' });

    render(<HuduAssetLayoutMapManager />);
    await screen.findByText('Computer Assets');

    fireEvent.click(screen.getByRole('button', { name: 'Save layout map' }));

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('boom');
    });
  });

  it('shows the load error and no table when the fetch fails', async () => {
    getHuduAssetLayoutMapMock.mockResolvedValue({ success: false, error: 'fetch failed' });

    render(<HuduAssetLayoutMapManager />);

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('fetch failed');
    });
    expect(screen.queryByTestId('hudu-layout-type-select-7')).toBeNull();
  });

  it('shows the empty state when Hudu has no layouts', async () => {
    getHuduAssetLayoutMapMock.mockResolvedValue({ success: true, data: { layouts: [], map: {} } });

    render(<HuduAssetLayoutMapManager />);

    await screen.findByText('No asset layouts found in Hudu.');
    expect(screen.queryByRole('button', { name: 'Save layout map' })).toBeNull();
  });

  it("T318: registry types drive the select — customs by registry name, built-ins translated, Don't import last", async () => {
    getHuduAssetLayoutMapMock.mockResolvedValue({ success: true, data: layoutsDataWithTypes });

    render(<HuduAssetLayoutMapManager />);
    await screen.findByText('Computer Assets');

    const select = screen.getByTestId('hudu-layout-type-select-7') as HTMLSelectElement;
    const options = Array.from(select.options).map((o) => ({ value: o.value, label: o.textContent }));
    expect(options).toEqual([
      { value: 'workstation', label: 'Workstation' },
      { value: 'server', label: 'Server' },
      { value: 'unknown', label: 'Unknown' },
      { value: 'firewall_rules', label: 'Firewall Rules' },
      { value: 'excluded', label: "Don't import" },
    ]);
  });

  it('T318: a custom slug is selectable and Save persists it', async () => {
    getHuduAssetLayoutMapMock.mockResolvedValue({ success: true, data: layoutsDataWithTypes });
    setHuduAssetLayoutMapMock.mockResolvedValue({
      success: true,
      data: { map: { '7': 'firewall_rules', '9': 'server' } },
    });

    render(<HuduAssetLayoutMapManager />);
    await screen.findByText('Computer Assets');

    fireEvent.change(screen.getByTestId('hudu-layout-type-select-7'), {
      target: { value: 'firewall_rules' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save layout map' }));

    await waitFor(() => {
      expect(setHuduAssetLayoutMapMock).toHaveBeenCalledWith({ '7': 'firewall_rules', '9': 'server' });
    });
    await screen.findByText('Asset layout map saved.');
  });

  it('T319: the create-type button runs the action, refreshes the table and shows the new assignment', async () => {
    getHuduAssetLayoutMapMock
      .mockResolvedValueOnce({ success: true, data: layoutsDataWithTypes })
      .mockResolvedValueOnce({
        success: true,
        data: {
          layouts: [
            { id: 7, name: 'Computer Assets', suggestedType: 'workstation', configuredType: 'computer_assets' },
            { id: 9, name: 'Databases', suggestedType: 'unknown', configuredType: 'server' },
          ],
          map: { '7': 'computer_assets', '9': 'server' },
          types: [...registryTypes, { slug: 'computer_assets', name: 'Computer Assets', is_builtin: false }],
        },
      });
    createAssetTypeFromHuduLayoutMock.mockResolvedValue({
      success: true,
      data: {
        type: { slug: 'computer_assets', name: 'Computer Assets', is_builtin: false, fields_schema: [] },
        map: { '7': 'computer_assets', '9': 'server' },
      },
    });

    render(<HuduAssetLayoutMapManager />);
    await screen.findByText('Computer Assets');

    const button = document.getElementById('hudu-layout-create-type-7') as HTMLButtonElement;
    expect(button).toBeTruthy();
    fireEvent.click(button);

    await waitFor(() => {
      expect(createAssetTypeFromHuduLayoutMock).toHaveBeenCalledWith({ layoutId: 7 });
    });
    await screen.findByText('Asset type created and assigned to this layout.');
    // The table reloaded and now reflects the stored assignment.
    expect(getHuduAssetLayoutMapMock).toHaveBeenCalledTimes(2);
    await waitFor(() => {
      expect((screen.getByTestId('hudu-layout-type-select-7') as HTMLSelectElement).value).toBe(
        'computer_assets'
      );
    });
  });

  it('T319: a slug conflict surfaces inline without refreshing the table', async () => {
    getHuduAssetLayoutMapMock.mockResolvedValue({ success: true, data: layoutsDataWithTypes });
    createAssetTypeFromHuduLayoutMock.mockResolvedValue({
      success: false,
      error: 'An asset type already exists for slug "computer_assets".',
      code: 'slug_conflict',
      slug: 'computer_assets',
    });

    render(<HuduAssetLayoutMapManager />);
    await screen.findByText('Computer Assets');

    fireEvent.click(document.getElementById('hudu-layout-create-type-7') as HTMLButtonElement);

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain(
        'An asset type with this name already exists. Choose it from the list instead.'
      );
    });
    expect(getHuduAssetLayoutMapMock).toHaveBeenCalledTimes(1);
  });

  it('T319: the create-type button is disabled while the action runs', async () => {
    getHuduAssetLayoutMapMock.mockResolvedValue({ success: true, data: layoutsDataWithTypes });
    let resolveCreate: (value: unknown) => void = () => undefined;
    createAssetTypeFromHuduLayoutMock.mockImplementation(
      () => new Promise((resolve) => { resolveCreate = resolve; })
    );

    render(<HuduAssetLayoutMapManager />);
    await screen.findByText('Computer Assets');

    const button = document.getElementById('hudu-layout-create-type-7') as HTMLButtonElement;
    fireEvent.click(button);

    await waitFor(() => {
      expect((document.getElementById('hudu-layout-create-type-7') as HTMLButtonElement).disabled).toBe(true);
    });

    resolveCreate({
      success: true,
      data: { type: { slug: 'computer_assets', name: 'Computer Assets' }, map: { '7': 'computer_assets' } },
    });
    await screen.findByText('Asset type created and assigned to this layout.');
    await waitFor(() => {
      expect((document.getElementById('hudu-layout-create-type-7') as HTMLButtonElement).disabled).toBe(false);
    });
  });
});
