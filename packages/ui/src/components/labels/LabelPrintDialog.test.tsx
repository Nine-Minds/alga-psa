/** @vitest-environment jsdom */

import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createInstance, type TFunction } from 'i18next';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const frCommon = JSON.parse(readFileSync(
  resolve(__dirname, '../../../../../server/public/locales/fr/common.json'), 'utf8',
));

const translation = vi.hoisted(() => ({ t: null as TFunction | null }));

const hook = vi.hoisted(() => ({
  print: vi.fn(),
  loadTemplates: vi.fn(),
  loadLinkedAssets: vi.fn(),
}));

vi.mock('../../lib/i18n/client', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      if (translation.t) return translation.t(key, options);
      let s = String(options?.defaultValue ?? key);
      for (const [k, v] of Object.entries(options ?? {})) s = s.replace(`{{${k}}}`, String(v));
      return s;
    },
  }),
}));
vi.mock('./useLabelPrint', () => ({
  useLabelPrint: () => ({ ...hook, isPrinting: false }),
}));
vi.mock('../Dialog', () => ({
  Dialog: ({ isOpen, children, footer }: { isOpen: boolean; children: React.ReactNode; footer?: React.ReactNode }) =>
    isOpen ? <div>{children}<div data-testid="dialog-footer">{footer}</div></div> : null,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('../CustomSelect', () => ({
  default: ({ id, disabled, options }: { id: string; disabled?: boolean; options: Array<{ value: string; label: string }> }) => (
    <div data-testid="select" id={id} data-disabled={String(Boolean(disabled))} data-options={JSON.stringify(options.map((o) => o.label))} />
  ),
}));
vi.mock('../Checkbox', () => ({
  Checkbox: ({ id, label, checked, onChange }: { id: string; label: string; checked: boolean; onChange: (e: unknown) => void }) => (
    <label>{label}<input type="checkbox" id={id} checked={checked} onChange={onChange as never} /></label>
  ),
}));
vi.mock('../Input', () => ({
  Input: ({ label, value, onChange, id }: { label: string; value: string; onChange: (e: unknown) => void; id: string }) => (
    <label>{label}<input id={id} value={value} onChange={onChange as never} /></label>
  ),
}));
vi.mock('../Button', () => ({
  Button: ({ children, onClick, disabled, id }: { children: React.ReactNode; onClick?: () => void; disabled?: boolean; id?: string }) => (
    <button id={id} onClick={onClick} disabled={disabled}>{children}</button>
  ),
}));

import { LabelPrintDialog, buildLabelSubjects } from './LabelPrintDialog';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

beforeEach(() => {
  translation.t = null;
  hook.print.mockReset();
  hook.loadTemplates.mockResolvedValue({ defaultTemplateId: 'standard-ticket-work-tag', templates: [{ id: 'standard-ticket-work-tag', name: 'Ticket', source: 'standard' }] });
  hook.loadLinkedAssets.mockResolvedValue([]);
});

describe('LabelPrintDialog', () => {
  it('places print and close actions in the dialog footer', () => {
    const onClose = vi.fn();
    render(<LabelPrintDialog isOpen onClose={onClose} labelClass="asset-identity" ids={[A]} />);
    const footer = screen.getByTestId('dialog-footer');
    expect(footer.contains(screen.getByText('Print'))).toBe(true);
    fireEvent.click(screen.getByText('Close'));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('reports the skipped count after printing', async () => {
    hook.print.mockResolvedValue({ status: 'printed', printed: 2, skipped: 3, blobUrl: 'blob:x', popupBlocked: false });
    render(<LabelPrintDialog isOpen onClose={vi.fn()} labelClass="asset-identity" ids={[A, B]} />);
    fireEvent.click(screen.getByText('Print'));
    await waitFor(() => expect(screen.getByText(/Printed 2 labels\./)).toBeTruthy());
    expect(screen.getByText(/3 records were skipped because they could not be opened\./)).toBeTruthy();
  });

  it('offers an Open PDF link when the popup was blocked', async () => {
    hook.print.mockResolvedValue({ status: 'printed', printed: 1, skipped: 0, blobUrl: 'blob:x', popupBlocked: true });
    render(<LabelPrintDialog isOpen onClose={vi.fn()} labelClass="asset-identity" ids={[A]} />);
    fireEvent.click(screen.getByText('Print'));
    await waitFor(() => expect(screen.getByText('Open PDF')).toBeTruthy());
  });

  it('lists 422 failures, and "Skip these" reprints without the failing records', async () => {
    hook.print
      .mockResolvedValueOnce({
        status: 'failed', httpStatus: 422, message: 'cannot print',
        failures: [{ index: 0, recordId: A, identifier: 'levelio:Z2lk', templateCode: 'x', message: 'too long', suggestedTemplateCode: 'standard-asset-label' }],
      })
      .mockResolvedValue({ status: 'printed', printed: 1, skipped: 0, blobUrl: 'blob:x', popupBlocked: false });
    render(<LabelPrintDialog isOpen onClose={vi.fn()} labelClass="asset-identity" ids={[A, B]} />);
    fireEvent.click(screen.getByText('Print'));
    await waitFor(() => expect(screen.getByText('Use standard-asset-label')).toBeTruthy());
    fireEvent.click(screen.getByText('Skip these and print the rest'));
    await waitFor(() => expect(hook.print).toHaveBeenCalledTimes(2));
    expect(hook.print.mock.calls[1][0].labels).toEqual([{ recordId: B }, { recordId: B }]);
  });

  it('renders French copy controls and prints the chosen copies adjacent for each asset', async () => {
    const missing = vi.fn();
    const i18n = createInstance();
    await i18n.init({ lng: 'fr', fallbackLng: false, resources: { fr: { common: frCommon } },
      saveMissing: true, missingKeyHandler: missing });
    translation.t = i18n.getFixedT('fr', 'common');
    hook.print.mockResolvedValue({ status: 'printed', printed: 6, skipped: 0, blobUrl: 'blob:x', popupBlocked: false });
    render(<LabelPrintDialog isOpen onClose={vi.fn()} labelClass="asset-identity" ids={[A, B]} />);
    const copies = screen.getByLabelText('Exemplaires par actif') as HTMLInputElement;
    expect(copies.value).toBe('2');
    expect(screen.getByText('Les exemplaires de chaque actif sont imprimés ensemble.')).toBeTruthy();
    fireEvent.change(copies, { target: { value: '3' } });
    fireEvent.click(screen.getByText('Imprimer'));
    await waitFor(() => expect(hook.print).toHaveBeenCalled());
    expect(hook.print.mock.calls[0][0].labels).toEqual([
      { recordId: A }, { recordId: A }, { recordId: A },
      { recordId: B }, { recordId: B }, { recordId: B },
    ]);
    expect(missing.mock.calls.map(call => call[2]).filter(key =>
      key === 'labels.dialog.copiesPerAsset' || key === 'labels.dialog.adjacentCopies'
    )).toEqual([]);
  });

  it('localizes a worksheet overflow error and preserves the affected sheet numbers', async () => {
    hook.print.mockResolvedValue({
      status: 'failed',
      httpStatus: 422,
      message: 'server fallback',
      failures: [],
      errorCode: 'worksheetTextOverflow',
      worksheetNumbers: [2, 4],
    });
    render(<LabelPrintDialog isOpen onClose={vi.fn()} labelClass="ticket-work-tag" ids={[A]} />);
    fireEvent.click(screen.getByText('Print'));
    await waitFor(() => expect(screen.getByText(
      'Worksheet 2, 4 contains text that will not fit. Adjust the layout or shorten the content before printing.',
    )).toBeTruthy());
    expect(screen.queryByText('server fallback')).toBeNull();
  });

  it('localizes worksheet page-size failures instead of showing the server fallback', async () => {
    hook.print.mockResolvedValue({
      status: 'failed',
      httpStatus: 422,
      message: 'server fallback',
      failures: [{ index: 0, recordId: A, identifier: 'TIC-1', templateCode: 'custom', message: 'server detail', errorCode: 'worksheetPageSize' }],
    });
    render(<LabelPrintDialog isOpen onClose={vi.fn()} labelClass="ticket-work-tag" ids={[A]} />);
    fireEvent.click(screen.getByText('Print'));
    await waitFor(() => expect(screen.getByText(
      /The worksheet does not fit the selected print layout/,
    )).toBeTruthy());
    expect(screen.queryByText('server fallback')).toBeNull();
    expect(screen.queryByText(/server detail/)).toBeNull();
  });

  it('disables printing above the 200-label limit and says why', async () => {
    const ids = Array.from({ length: 201 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`);
    render(<LabelPrintDialog isOpen onClose={vi.fn()} labelClass="asset-identity" ids={ids} />);
    expect(screen.getByText('You can print at most 200 labels at a time.')).toBeTruthy();
    expect((screen.getByText('Print') as HTMLButtonElement).disabled).toBe(true);
  });

  it('single ticket: sends overrides only for fields the user changed', async () => {
    hook.print.mockResolvedValue({ status: 'printed', printed: 1, skipped: 0, blobUrl: 'blob:x', popupBlocked: false });
    render(<LabelPrintDialog isOpen onClose={vi.fn()} labelClass="ticket-work-tag" ids={[A]} defaultTitle="Broken screen" />);
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Warranty' } });
    fireEvent.click(screen.getByText('Print'));
    await waitFor(() => expect(hook.print).toHaveBeenCalled());
    expect(hook.print.mock.calls[0][0].overrides).toEqual({ detail: 'Warranty' });
    expect(hook.print.mock.calls[0][0].labels).toEqual([{ recordId: A }]);
    expect(hook.print.mock.calls[0][0].linkedAssetId).toBeUndefined();
  });
});

describe('LabelPrintDialog - picked custody (ticket work tag)', () => {
  const held = (loc: string) => ({ custodyLocation: loc, nextAction: 'Follow up Oct 29' });
  const choices3 = [
    { assetId: 'a1', assetTag: 'T-1', name: 'Dock', custody: held('Main Office / Shelf A1') },
    { assetId: 'a2', assetTag: 'T-2', name: 'Laptop', custody: held('Main Office / Shelf B3') },
    { assetId: 'a3', assetTag: 'T-3', name: 'Phone', custody: held('Main Office / Shelf C2') },
  ];
  const open = () => render(<LabelPrintDialog isOpen onClose={vi.fn()} labelClass="ticket-work-tag" ids={[A]} />);
  const printedOk = { status: 'printed', printed: 3, skipped: 0, blobUrl: 'blob:x', popupBlocked: false };

  it('buildLabelSubjects: batch is one subject per held item; otherwise one subject with the pick', () => {
    const mixed = [...choices3, { assetId: 'a4', assetTag: 'T-4', name: 'Not held', custody: null }];
    expect(buildLabelSubjects(A, mixed, '__none__', true)).toEqual([
      { recordId: A, linkedAssetId: 'a1' }, { recordId: A, linkedAssetId: 'a2' }, { recordId: A, linkedAssetId: 'a3' },
    ]);
    expect(buildLabelSubjects(A, mixed, 'a2', false)).toEqual([{ recordId: A, linkedAssetId: 'a2' }]);
    expect(buildLabelSubjects(A, mixed, '__none__', false)).toEqual([{ recordId: A }]);
  });

  it('three held items: batch option shows with the count, and the preview says "3 items held."', async () => {
    hook.loadLinkedAssets.mockResolvedValue(choices3);
    open();
    await waitFor(() => expect(screen.getByLabelText('One tag per held item (3)')).toBeTruthy());
    expect(screen.getByText('3 items held.')).toBeTruthy();
    expect(document.getElementById('label-print-linked-asset-select')!.getAttribute('data-disabled')).toBe('false');
  });

  it('turning batch on disables the picker, previews the count and sends three subjects with distinct assets', async () => {
    hook.loadLinkedAssets.mockResolvedValue(choices3);
    hook.print.mockResolvedValue(printedOk);
    open();
    fireEvent.click(await screen.findByLabelText('One tag per held item (3)'));
    expect(screen.getByText('Print 3 tags, one per held item.')).toBeTruthy();
    expect(document.getElementById('label-print-linked-asset-select')!.getAttribute('data-disabled')).toBe('true');
    fireEvent.click(screen.getByText('Print'));
    await waitFor(() => expect(hook.print).toHaveBeenCalled());
    const labels = hook.print.mock.calls[0][0].labels;
    expect(labels).toEqual(['a1', 'a2', 'a3'].map((linkedAssetId) => ({ recordId: A, linkedAssetId })));
  });

  it('picker options carry the shelf, never a raw id', async () => {
    hook.loadLinkedAssets.mockResolvedValue([...choices3, { assetId: 'raw-id-9', assetTag: null, name: null, custody: null }]);
    open();
    await waitFor(() => expect(document.getElementById('label-print-linked-asset-select')).toBeTruthy());
    const options = JSON.parse(document.getElementById('label-print-linked-asset-select')!.getAttribute('data-options')!);
    expect(options).toContain('T-2 - Laptop \u2014 Main Office / Shelf B3');
    expect(JSON.stringify(options)).not.toContain('raw-id-9');
  });

  it('one held item: no batch option, preview names the location, one subject is sent', async () => {
    hook.loadLinkedAssets.mockResolvedValue([choices3[0]]);
    hook.print.mockResolvedValue({ ...printedOk, printed: 1 });
    open();
    await waitFor(() => expect(screen.getByText('The tag will show Main Office / Shelf A1.')).toBeTruthy());
    expect(screen.queryByLabelText(/One tag per held item/)).toBeNull();
    fireEvent.click(screen.getByText('Print'));
    await waitFor(() => expect(hook.print).toHaveBeenCalled());
    expect(hook.print.mock.calls[0][0].labels).toEqual([{ recordId: A }]);
  });

  it('nothing held: no batch option and no custody preview', async () => {
    hook.loadLinkedAssets.mockResolvedValue([{ assetId: 'a1', assetTag: 'T-1', name: 'Dock', custody: null }]);
    open();
    await waitFor(() => expect(hook.loadLinkedAssets).toHaveBeenCalled());
    expect(screen.queryByLabelText(/One tag per held item/)).toBeNull();
    expect(document.getElementById('label-print-preview')).toBeNull();
  });
});
