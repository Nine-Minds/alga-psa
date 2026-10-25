/** @vitest-environment jsdom */

import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const hook = vi.hoisted(() => ({
  print: vi.fn(),
  loadTemplates: vi.fn(),
  loadLinkedAssets: vi.fn(),
}));

vi.mock('../../lib/i18n/client', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
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
  Dialog: ({ isOpen, children }: { isOpen: boolean; children: React.ReactNode }) => (isOpen ? <div>{children}</div> : null),
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('../CustomSelect', () => ({ default: () => <div data-testid="select" /> }));
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

import { LabelPrintDialog } from './LabelPrintDialog';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

beforeEach(() => {
  hook.print.mockReset();
  hook.loadTemplates.mockResolvedValue({ defaultTemplateId: 'standard-ticket-work-tag', templates: [{ id: 'standard-ticket-work-tag', name: 'Ticket', source: 'standard' }] });
  hook.loadLinkedAssets.mockResolvedValue([]);
});

describe('LabelPrintDialog', () => {
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
    expect(hook.print.mock.calls[1][0].ids).toEqual([B]);
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
    expect(hook.print.mock.calls[0][0].linkedAssetId).toBeUndefined();
  });
});
