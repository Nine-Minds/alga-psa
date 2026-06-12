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

const { getHuduAssetLayoutMapMock, setHuduAssetLayoutMapMock } = vi.hoisted(() => ({
  getHuduAssetLayoutMapMock: vi.fn(),
  setHuduAssetLayoutMapMock: vi.fn(),
}));

vi.mock('@ee/lib/actions/integrations/huduLayoutMapActions', () => ({
  getHuduAssetLayoutMap: getHuduAssetLayoutMapMock,
  setHuduAssetLayoutMap: setHuduAssetLayoutMapMock,
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

describe('HuduAssetLayoutMapManager', () => {
  beforeEach(() => {
    getHuduAssetLayoutMapMock.mockReset();
    setHuduAssetLayoutMapMock.mockReset();
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
});
