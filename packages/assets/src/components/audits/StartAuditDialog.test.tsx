// @vitest-environment jsdom
/// <reference types="@testing-library/jest-dom/vitest" />
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SWRConfig } from 'swr';

const h = vi.hoisted(() => ({
  startAssetAudit: vi.fn(),
  previewAssetAuditScope: vi.fn(),
  getClientLocationsForAssets: vi.fn(),
  onStarted: vi.fn(),
  onOpenChange: vi.fn(),
}));

vi.mock('../../actions/assetAuditActions', () => ({
  startAssetAudit: h.startAssetAudit,
  previewAssetAuditScope: h.previewAssetAuditScope,
}));
vi.mock('../../actions/clientLookupActions', () => ({
  getClientLocationsForAssets: h.getClientLocationsForAssets,
}));
vi.mock('../shared/useAssetStatusOptions', () => ({
  useAssetStatusRegistry: () => ({
    statuses: [
      { slug: 'active', label: 'Active', kind: 'deployable', is_active: true },
      { slug: 'in_stock', label: 'In stock', kind: 'pending', is_active: true },
      { slug: 'retired', label: 'Retired', kind: 'retired', is_active: true },
    ],
    reload: () => {},
  }),
}));
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({
    t: (key: string, options?: any) => {
      const count = typeof options?.count === 'number' ? options.count : null;
      const value =
        options?.defaultValue ?? (count === 1 ? options?.defaultValue_one : options?.defaultValue_other) ?? key;
      return String(value).replace(/\{\{(\w+)\}\}/g, (_m, name) => String(options?.[name] ?? ''));
    },
    i18n: { language: 'en-US' },
  }),
}));
vi.mock('@alga-psa/ui/components/Button', () => ({
  Button: ({ id, children, onClick, disabled }: any) => (
    <button id={id} type="button" onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
}));
vi.mock('@alga-psa/ui/components/Checkbox', () => ({
  Checkbox: ({ id, label, checked, onChange }: any) => (
    <label htmlFor={id}>
      <input id={id} type="checkbox" checked={Boolean(checked)} onChange={onChange} />
      {label}
    </label>
  ),
}));
vi.mock('@alga-psa/ui/components/ClientPicker', () => ({
  ClientPicker: ({ id, selectedClientId, onSelect }: any) => (
    <button id={id} type="button" data-selected={selectedClientId ?? ''} onClick={() => onSelect('acme')}>
      pick client
    </button>
  ),
}));
vi.mock('@alga-psa/ui/components/CustomSelect', () => ({
  default: ({ id, value, options, onValueChange, disabled }: any) => (
    <select aria-label={id} id={id} value={value} disabled={disabled} onChange={(e) => onValueChange(e.target.value)}>
      {options.map((option: any) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  ),
}));
vi.mock('@alga-psa/ui/components/Dialog', () => ({
  Dialog: ({ id, isOpen, title, children }: any) =>
    isOpen ? (
      <div id={id} role="dialog">
        <h2>{title}</h2>
        {children}
      </div>
    ) : null,
  DialogContent: ({ children }: any) => <div>{children}</div>,
  DialogFooter: ({ children }: any) => <div>{children}</div>,
}));
vi.mock('@alga-psa/ui/components/Label', () => ({
  Label: ({ htmlFor, children }: any) => <label htmlFor={htmlFor}>{children}</label>,
}));
vi.mock('@alga-psa/ui/components/TextArea', () => ({
  TextArea: ({ id, value, onChange, placeholder }: any) => (
    <textarea id={id} value={value} onChange={onChange} placeholder={placeholder} />
  ),
}));

const { StartAuditDialog } = await import('./StartAuditDialog');

function renderDialog(clientId: string | null = 'acme') {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <StartAuditDialog
        open
        clientId={clientId}
        onOpenChange={h.onOpenChange}
        onStarted={h.onStarted}
      />
    </SWRConfig>,
  );
}

beforeEach(() => {
  Object.values(h).forEach((fn) => (fn as any).mockReset?.());
  h.previewAssetAuditScope.mockResolvedValue({ success: true, data: { expected_count: 7 } });
  h.getClientLocationsForAssets.mockResolvedValue([
    { location_id: 'loc-1', location_name: 'HQ', address_line1: '1 Yellow Brick Rd' },
  ]);
  h.startAssetAudit.mockResolvedValue({ success: true, data: { audit_id: 'au-9' } });
});

afterEach(cleanup);

describe('StartAuditDialog', () => {
  it('starts the run with the previewed scope and hands the id back', async () => {
    renderDialog();

    await waitFor(() => expect(document.getElementById('start-audit-dialog-expected')).toHaveTextContent(
      '7 devices expected in this scope',
    ));

    fireEvent.click(document.getElementById('start-audit-dialog-submit-button')!);

    await waitFor(() =>
      expect(h.startAssetAudit).toHaveBeenCalledWith({
        client_id: 'acme',
        location_id: null,
        // Mobile parity: the deployable and pending kinds are the default scope.
        statuses: ['active', 'in_stock'],
      }),
    );
    await waitFor(() => expect(h.onStarted).toHaveBeenCalledWith('au-9'));
    expect(h.onOpenChange).toHaveBeenCalledWith(false);
  });

  it('shows the server refusal and stays open', async () => {
    h.startAssetAudit.mockResolvedValue({ success: false, error: { message: 'No assets in this scope' } });
    renderDialog();

    fireEvent.click(document.getElementById('start-audit-dialog-submit-button')!);

    expect(await screen.findByRole('alert')).toHaveTextContent('No assets in this scope');
    expect(h.onStarted).not.toHaveBeenCalled();
  });

  // A thrown action answers nothing: without a catch the button sat on
  // "Starting…" for good and said nothing about why.
  it('recovers from a thrown start instead of sitting on "Starting…"', async () => {
    h.startAssetAudit.mockRejectedValue(new Error('Connection terminated unexpectedly'));
    renderDialog();

    fireEvent.click(document.getElementById('start-audit-dialog-submit-button')!);

    expect(await screen.findByRole('alert')).toHaveTextContent('An error occurred. Please try again later.');
    expect(screen.queryByText(/Connection terminated/)).toBeNull();
    const submit = document.getElementById('start-audit-dialog-submit-button')!;
    await waitFor(() => expect(submit).not.toBeDisabled());
    expect(submit).toHaveTextContent('Start audit');
    expect(h.onStarted).not.toHaveBeenCalled();
  });

  it('does nothing until a client is chosen', async () => {
    renderDialog(null);

    expect(document.getElementById('start-audit-dialog-submit-button')).toBeDisabled();
    expect(document.getElementById('start-audit-dialog-expected')).toHaveTextContent(
      'Pick a client to see what is in scope.',
    );
    expect(h.previewAssetAuditScope).not.toHaveBeenCalled();
  });
});
