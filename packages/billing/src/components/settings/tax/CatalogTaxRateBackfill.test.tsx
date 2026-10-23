// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const actions = vi.hoisted(() => ({
  preview: vi.fn(),
  apply: vi.fn(),
}));

vi.mock('../../../actions/taxSettingsActions', () => ({
  previewCatalogTaxRateBackfill: (...args: unknown[]) => actions.preview(...args),
  applyCatalogTaxRateBackfill: (...args: unknown[]) => actions.apply(...args),
}));

vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

vi.mock('@alga-psa/ui/components/Card', () => ({
  Card: ({ children }: any) => <div>{children}</div>,
  CardHeader: ({ children }: any) => <div>{children}</div>,
  CardTitle: ({ children }: any) => <div>{children}</div>,
  CardDescription: ({ children }: any) => <div>{children}</div>,
  CardContent: ({ children }: any) => <div>{children}</div>,
}));
vi.mock('@alga-psa/ui/components/Button', () => ({
  Button: ({ children, ...props }: any) => <button {...props}>{children}</button>,
}));
vi.mock('@alga-psa/ui/components/Dialog', () => ({
  Dialog: ({ isOpen, children, footer }: any) => (isOpen ? <div>{children}{footer}</div> : null),
  DialogContent: ({ children }: any) => <div>{children}</div>,
}));
vi.mock('@alga-psa/ui/components/Alert', () => ({
  Alert: ({ children }: any) => <div>{children}</div>,
  AlertDescription: ({ children }: any) => <div>{children}</div>,
}));
vi.mock('@alga-psa/ui/components/Checkbox', () => ({
  Checkbox: ({ id, checked, onChange }: any) => (
    <input id={id} type="checkbox" checked={checked} onChange={onChange} />
  ),
}));
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({
    t: (_key: string, values: any = {}) =>
      String(values.defaultValue ?? '').replace(/{{(\w+)}}/g, (_m: string, key: string) => values[key]),
  }),
}));
vi.mock('@alga-psa/ui/lib/errorHandling', () => ({
  handleError: vi.fn(),
  getErrorMessage: (value: any) => value?.actionError ?? value?.permissionError ?? 'error',
  isActionMessageError: (value: any) => Boolean(value && 'actionError' in value),
  isActionPermissionError: (value: any) => Boolean(value && 'permissionError' in value),
}));

import { CatalogTaxRateBackfill } from './CatalogTaxRateBackfill';

const previewWith = (serviceId = 's1') => ({
  default_tax_rate_id: 'rate-1',
  default_tax_rate: {
    tax_rate_id: 'rate-1',
    region_code: 'AU-GST',
    region_name: 'GST',
    description: 'GST',
    tax_percentage: 10,
  },
  items: [{ service_id: serviceId, service_name: 'Backfill Item', item_kind: 'service' as const }],
  count: 1,
});

const previewButton = () => document.getElementById('preview-catalog-tax-backfill-button') as HTMLButtonElement;
const applyButton = () => document.getElementById('apply-catalog-tax-backfill-button') as HTMLButtonElement;

describe('CatalogTaxRateBackfill', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(cleanup);

  it('clears a previously loaded preview and disables Apply when a reload fails', async () => {
    actions.preview.mockResolvedValueOnce(previewWith());
    render(<CatalogTaxRateBackfill />);

    fireEvent.click(previewButton());
    await screen.findByText('Backfill Item');
    expect(applyButton().disabled).toBe(false);

    actions.preview.mockResolvedValueOnce({ actionError: 'preview failed' });
    fireEvent.click(previewButton());
    await waitFor(() => expect(applyButton().disabled).toBe(true));

    // The stale selection is gone, so it cannot be submitted.
    expect(screen.queryByText('Backfill Item')).toBeNull();
  });

  it('disables Apply while a preview reload is loading', async () => {
    actions.preview.mockResolvedValueOnce(previewWith());
    render(<CatalogTaxRateBackfill />);

    fireEvent.click(previewButton());
    await screen.findByText('Backfill Item');
    expect(applyButton().disabled).toBe(false);

    let release: (value: unknown) => void = () => undefined;
    actions.preview.mockReturnValueOnce(
      new Promise((resolve) => {
        release = resolve;
      }),
    );
    fireEvent.click(previewButton());
    await waitFor(() => expect(applyButton().disabled).toBe(true));

    release(previewWith());
    await waitFor(() => expect(applyButton().disabled).toBe(false));
  });

  it('passes the previewed default id to apply', async () => {
    actions.preview.mockResolvedValue(previewWith('s1'));
    actions.apply.mockResolvedValue({ changed: 1, skipped: 0 });
    render(<CatalogTaxRateBackfill />);

    fireEvent.click(previewButton());
    await screen.findByText('Backfill Item');

    fireEvent.click(applyButton());
    await waitFor(() =>
      expect(actions.apply).toHaveBeenCalledWith(['s1'], 'rate-1'),
    );
  });
});
