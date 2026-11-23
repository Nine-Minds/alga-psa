// @vitest-environment jsdom
/**
 * Focus mode on the invoice layout editor: the saved preference decides how it opens, the header
 * toggle switches it, and the compact header row survives the switch with the author's edits.
 */
import React from 'react';
import { cleanup, render, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const preferences = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  getUserPreference: vi.fn(),
  setUserPreference: vi.fn(),
}));
const getInvoiceTemplateMock = vi.hoisted(() => vi.fn());
const saveInvoiceTemplateMock = vi.hoisted(() => vi.fn());
const monacoHeights = vi.hoisted(() => [] as Array<string | number>);

vi.mock('@alga-psa/user-composition/actions', () => ({
  getCurrentUser: (...args: unknown[]) => preferences.getCurrentUser(...args),
  getUserPreference: (...args: unknown[]) => preferences.getUserPreference(...args),
  setUserPreference: (...args: unknown[]) => preferences.setUserPreference(...args),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => ({ toString: () => '', get: () => null }),
}));

vi.mock('@alga-psa/billing/actions/invoiceTemplates', () => ({
  getInvoiceTemplate: (...args: unknown[]) => getInvoiceTemplateMock(...args),
  saveInvoiceTemplate: (...args: unknown[]) => saveInvoiceTemplateMock(...args),
}));

vi.mock('@monaco-editor/react', () => ({
  Editor: (props: { height?: string | number }) => {
    monacoHeights.push(props.height ?? 'unset');
    return <textarea data-testid="monaco-mock" readOnly value="" />;
  },
}));

vi.mock('../invoice-designer/DesignerVisualWorkspace', () => ({
  DesignerVisualWorkspace: ({ fillHeight }: { fillHeight?: boolean }) => (
    <div data-testid="visual-workspace-mock" data-fill-height={fillHeight ? 'on' : 'off'} />
  ),
}));

import InvoiceTemplateEditor from './InvoiceTemplateEditor';

function surface(): HTMLElement | null {
  return document.getElementById('invoice-template-editor-surface');
}

beforeEach(() => {
  monacoHeights.length = 0;
  window.localStorage.clear();
  preferences.getCurrentUser.mockResolvedValue({ user_id: 'user-1' });
  preferences.getUserPreference.mockResolvedValue(null);
  preferences.setUserPreference.mockResolvedValue(undefined);
  getInvoiceTemplateMock.mockResolvedValue({
    template_id: 'template-1',
    name: 'Standard invoice',
    version: 2,
    isStandard: false,
    updated_at: '2026-11-19T10:00:00.000Z',
    created_at: '2026-11-01T10:00:00.000Z',
  });
  saveInvoiceTemplateMock.mockResolvedValue({ success: true, template: { template_id: 'template-1' } });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

async function renderEditor() {
  const result = render(<InvoiceTemplateEditor templateId="template-1" />);
  await waitFor(() => expect(surface()).not.toBeNull());
  return result;
}

describe('invoice layout editor focus mode', () => {
  it('puts the toggle before Close and saves the choice', async () => {
    await renderEditor();

    const toggle = document.getElementById('invoice-template-editor-focus-toggle')!;
    const close = document.getElementById('cancel-template-edit-button')!;
    expect(toggle.compareDocumentPosition(close) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    await userEvent.click(toggle);

    expect(surface()!.getAttribute('data-focus-mode')).toBe('on');
    await waitFor(() =>
      expect(preferences.setUserPreference).toHaveBeenCalledWith(
        'user-1',
        'designer_focus_mode_invoice_layout',
        true
      )
    );
  });

  it('opens focused from its own preference and not from another designer’s', async () => {
    preferences.getUserPreference.mockImplementation(async (_userId: string, key: string) =>
      key === 'designer_focus_mode_invoice_layout' ? true : null
    );
    await renderEditor();

    await waitFor(() => expect(surface()!.getAttribute('data-focus-mode')).toBe('on'));

    cleanup();
    preferences.getUserPreference.mockImplementation(async (_userId: string, key: string) =>
      key === 'designer_focus_mode_quote_layout' ? true : null
    );
    window.localStorage.clear();
    await renderEditor();

    expect(surface()!.getAttribute('data-focus-mode')).toBe('off');
  });

  it('keeps the whole header row, without card chrome, in focus mode', async () => {
    await renderEditor();
    await userEvent.click(document.getElementById('invoice-template-editor-focus-toggle')!);

    expect(document.getElementById('templateName')).not.toBeNull();
    expect(document.getElementById('template-save-status')).not.toBeNull();
    expect(document.getElementById('cancel-template-edit-button')).not.toBeNull();
    expect(document.getElementById('save-template-button')).not.toBeNull();

    const card = surface()!.firstElementChild as HTMLElement;
    expect(card.className).toContain('border-0');
    expect(card.className).toContain('rounded-none');
    expect(card.style.boxShadow).toBe('none');
    expect(document.querySelector('[data-testid="visual-workspace-mock"]')!.getAttribute('data-fill-height')).toBe(
      'on'
    );
  });

  it('recomputes the code editor height after a toggle', async () => {
    await renderEditor();
    await userEvent.click(document.querySelector('[data-automation-id="invoice-template-editor-code-tab"]')!);
    await waitFor(() => expect(monacoHeights.length).toBeGreaterThan(0));
    const before = monacoHeights.length;

    await userEvent.click(document.getElementById('invoice-template-editor-focus-toggle')!);

    await waitFor(() => expect(monacoHeights.length).toBeGreaterThan(before));
  });

  it('keeps the typed name and the active tab across a toggle', async () => {
    await renderEditor();
    const name = document.getElementById('templateName') as HTMLInputElement;
    await userEvent.clear(name);
    await userEvent.type(name, 'Renamed layout');
    await userEvent.click(document.querySelector('[data-automation-id="invoice-template-editor-code-tab"]')!);

    await userEvent.click(document.getElementById('invoice-template-editor-focus-toggle')!);

    expect((document.getElementById('templateName') as HTMLInputElement).value).toBe('Renamed layout');
    expect(
      document.querySelector('[data-automation-id="invoice-template-editor-code-tab"]')!.getAttribute('aria-selected')
    ).toBe('true');
  });
});
