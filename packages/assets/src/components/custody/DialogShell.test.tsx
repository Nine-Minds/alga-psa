// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({ t: (key: string, o: Record<string, unknown> = {}) => String(o.defaultValue ?? key) }),
}));
vi.mock('@alga-psa/ui/components/Button', () => ({ Button: ({ children, variant, ...p }: any) => <button {...p}>{children}</button> }));
vi.mock('@alga-psa/ui/components/Input', () => ({ Input: (p: any) => <input {...p} /> }));
vi.mock('@alga-psa/ui/components/Label', () => ({ Label: (p: any) => <label {...p} /> }));
vi.mock('@alga-psa/ui/components/TextArea', () => ({ TextArea: (p: any) => <textarea {...p} /> }));
vi.mock('@alga-psa/ui/components/UserPicker', () => ({ default: () => null }));
vi.mock('@alga-psa/ui/components/Dialog', () => ({
  Dialog: ({ isOpen, children, footer }: any) => (isOpen ? <div>{children}{footer}</div> : null),
  DialogContent: ({ children }: any) => <div>{children}</div>,
}));
vi.mock('../../actions/assetCustodyActions', () => ({}));
vi.mock('./custodyClient', () => ({ custodyOutcome: vi.fn(), useCustodyLocations: vi.fn(), useCustodyUsers: vi.fn() }));
vi.mock('./CustodyFields', () => ({
  CUSTODY_NOTE_MAX: 100, CustodyDetailFields: () => null, CustodyPlaceFields: () => null, cleanAccessories: () => [], emptyCustodyDetails: () => ({}),
}));

import { DialogShell } from './CustodyDialogs';

function renderShell(onSubmit: () => Promise<any>) {
  return render(
    <DialogShell id="shell" title="T" submitLabel="Go" isOpen onClose={() => {}} onSubmit={onSubmit}>
      <input id="shell-field" />
      <p>body</p>
    </DialogShell>
  );
}

afterEach(cleanup);

describe('DialogShell error contract', () => {
  it('renders a string error in the top alert, before the body, and focuses it', async () => {
    renderShell(async () => 'Server said no');
    fireEvent.click(document.getElementById('shell-submit')!);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe('Server said no');
    expect(alert.className).toContain('sticky');
    expect(alert.className).toContain('top-0');
    await waitFor(() => expect(document.activeElement).toBe(alert));
    expect(alert.compareDocumentPosition(screen.getByText('body')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('focuses the named field and marks it aria-invalid, clearing the mark when it changes', async () => {
    renderShell(async () => ({ message: 'Already held', fieldId: 'shell-field' }));
    fireEvent.click(document.getElementById('shell-submit')!);
    const field = document.getElementById('shell-field')!;
    await waitFor(() => expect(document.activeElement).toBe(field));
    expect(field.getAttribute('aria-invalid')).toBe('true');
    expect((await screen.findByRole('alert')).textContent).toBe('Already held');
    fireEvent.change(field, { target: { value: 'x' } });
    fireEvent.input(field);
    expect(field.hasAttribute('aria-invalid')).toBe(false);
  });

  it('scrolls the named field clear of the sticky alert using the alert height as scroll-margin', async () => {
    const scroll = vi.fn();
    (Element.prototype as any).scrollIntoView = scroll;
    const rect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ height: 38 } as DOMRect);
    try {
      renderShell(async () => ({ message: 'Already held', fieldId: 'shell-field' }));
      fireEvent.click(document.getElementById('shell-submit')!);
      const field = document.getElementById('shell-field')!;
      await waitFor(() => expect(document.activeElement).toBe(field));
      expect(field.getAttribute('aria-invalid')).toBe('true');
      expect(field.style.scrollMarginTop).toBe('54px');
      expect(scroll).toHaveBeenCalledWith({ block: 'nearest' });
      expect(scroll.mock.instances).toContain(field);
    } finally {
      rect.mockRestore();
      delete (Element.prototype as any).scrollIntoView;
    }
  });

  it('falls back to the alert when the field id does not exist, and clears on the next submit', async () => {
    const onSubmit = vi.fn().mockResolvedValueOnce({ message: 'Nope', fieldId: 'missing' }).mockResolvedValueOnce(null);
    renderShell(onSubmit);
    fireEvent.click(document.getElementById('shell-submit')!);
    const alert = await screen.findByRole('alert');
    await waitFor(() => expect(document.activeElement).toBe(alert));
    fireEvent.click(document.getElementById('shell-submit')!);
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  });

  it('turns a thrown error into the alert', async () => {
    renderShell(async () => { throw new Error('boom'); });
    fireEvent.click(document.getElementById('shell-submit')!);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe('boom');
    await waitFor(() => expect(document.activeElement).toBe(alert));
  });

  it('keeps a pending submission busy, then focuses the alert when the response arrives', async () => {
    let resolveFailure!: (message: string) => void;
    const response = new Promise<string>((resolve) => { resolveFailure = resolve; });
    renderShell(() => response);
    const submit = document.getElementById('shell-submit') as HTMLButtonElement;
    const cancel = document.getElementById('shell-cancel') as HTMLButtonElement;

    fireEvent.click(submit);
    expect(submit.disabled).toBe(true);
    expect(cancel.disabled).toBe(true);
    expect(screen.queryByRole('alert')).toBeNull();

    resolveFailure('Server said no');
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe('Server said no');
    // Rendering the alert and focusing it happen in separate React phases.
    await waitFor(() => expect(document.activeElement).toBe(alert));
    expect(submit.disabled).toBe(false);
    expect(cancel.disabled).toBe(false);
  });
});
