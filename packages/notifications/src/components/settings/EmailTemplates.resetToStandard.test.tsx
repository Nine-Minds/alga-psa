/* @vitest-environment jsdom */

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const actions = vi.hoisted(() => ({
  getTemplatesAction: vi.fn(),
  getEmailBrandingStatusAction: vi.fn(),
  applyEmailBrandingAction: vi.fn(),
  updateTenantTemplateAction: vi.fn(),
  cloneSystemTemplateAction: vi.fn(),
  deactivateTenantTemplateAction: vi.fn(),
  isNotificationActionError: vi.fn(() => false),
  sendTestEmailAction: vi.fn(),
}));

vi.mock('../../actions', () => actions);
// One stable session object: the component reloads its templates whenever the session identity changes.
const session = vi.hoisted(() => ({ data: { user: { tenant: 'tenant-1' } } }));
vi.mock('next-auth/react', () => ({ useSession: () => session }));
vi.mock('@alga-psa/user-composition/hooks', () => ({
  useUserPreference: () => ({ value: 50, setValue: vi.fn() }),
}));
vi.mock('@alga-psa/tenancy/actions/tenant-actions/tenantLocaleActions', () => ({
  getTenantLocaleSettingsAction: vi.fn(async () => ({ defaultLocale: 'en' })),
}));
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: any) => {
      const text = typeof fallback === 'string' ? fallback : fallback?.defaultValue ?? key;
      return text.replace(/\{\{(\w+)\}\}/g, (_m: string, name: string) => String(fallback?.[name] ?? ''));
    },
  }),
}));
vi.mock('./EmailTemplatePreview', () => ({ EmailTemplatePreview: () => null }));
vi.mock('@alga-psa/ui/components/DataTable', () => ({
  DataTable: ({ data, columns, onRowClick }: any) => (
    <div>
      {data.map((row: any, index: number) => (
        <div key={row.id} data-testid={row.id} onClick={() => onRowClick?.(row)}>
          {columns.map((column: any, i: number) => (
            <div key={i}>{column.render ? column.render(row[column.dataIndex], row, index) : null}</div>
          ))}
        </div>
      ))}
    </div>
  ),
}));

// The package compiles JSX with the classic runtime, so the component under test expects React in scope.
(globalThis as any).React = React;

const { EmailTemplates } = await import('./EmailTemplates');

const system = { id: 'sys-1', name: 'quote-email', language_code: 'en', subject: 'Quote', html_content: '<p>x</p>', text_content: 'x', category: 'Quotes' };
const tenantRow = { id: 5, name: 'quote-email', language_code: 'en', subject: 'Mine', html_content: '<p>mine</p>', text_content: 'mine', derived: false, missingVariables: ['quoteReviewLink'] };

async function openResetDialog() {
  render(<EmailTemplates />);
  fireEvent.click(await screen.findByTestId('cat_Quotes'));
  fireEvent.click(await screen.findByRole('button', { name: 'Reset to standard' }));
  await screen.findByText(/will be replaced by the standard template in your brand/);
}

beforeEach(() => {
  actions.getTemplatesAction.mockResolvedValue({ systemTemplates: [system], tenantTemplates: [tenantRow] });
  actions.getEmailBrandingStatusAction.mockResolvedValue({ palette: { primary: '#aa2200' }, resolved: {}, logoOptions: {} });
  actions.applyEmailBrandingAction.mockResolvedValue({ written: [], skipped: [], failed: [], appliedAt: null });
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  Object.values(actions).forEach((fn) => (fn as any).mockReset?.());
});

describe('Reset to standard', () => {
  it('asks first, and cancelling closes the dialog without calling the action', async () => {
    await openResetDialog();
    expect(actions.applyEmailBrandingAction).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(screen.queryByText(/will be replaced by the standard template/)).toBeNull());
    expect(actions.applyEmailBrandingAction).not.toHaveBeenCalled();
    expect(actions.getTemplatesAction).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Reset to standard' })).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('resets the named template and language once confirmed', async () => {
    await openResetDialog();

    const confirm = document.getElementById('confirm-reset-to-standard-confirm') as HTMLElement;
    fireEvent.click(confirm);

    await waitFor(() => expect(actions.applyEmailBrandingAction).toHaveBeenCalledTimes(1));
    expect(actions.applyEmailBrandingAction).toHaveBeenCalledWith({ names: ['quote-email'], languages: ['en'], overwrite: ['quote-email'] });
    await waitFor(() => expect(screen.queryByText(/will be replaced by the standard template/)).toBeNull());
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows an error the user can act on when the reset reports a failure', async () => {
    actions.applyEmailBrandingAction.mockResolvedValue({ written: [], skipped: [], failed: [{ name: 'quote-email', language: 'en', error: 'db' }], appliedAt: null });
    await openResetDialog();

    fireEvent.click(document.getElementById('confirm-reset-to-standard-confirm') as HTMLElement);

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/wasn't reset and still has your edits/);
    expect(alert.textContent).toMatch(/Use Standard/);
  });

  it('points to applying branding or Use Standard when no palette is saved', async () => {
    actions.applyEmailBrandingAction.mockRejectedValue(new Error('No email branding palette has been saved'));
    await openResetDialog();

    fireEvent.click(document.getElementById('confirm-reset-to-standard-confirm') as HTMLElement);

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/no brand palette is saved/);
    expect(alert.textContent).toMatch(/Apply email branding first/);
    expect(alert.textContent).toMatch(/Use Standard/);
  });
});
