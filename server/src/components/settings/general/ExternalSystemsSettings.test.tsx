// @vitest-environment jsdom
/// <reference types="@testing-library/jest-dom/vitest" />

import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// The real shared DataTable must render here: the defect was duplicate column
// identities (`key` used for both the Key and Actions columns), which only the
// real column->renderer resolution surfaces. Do not replace it with a stub.
const actionMocks = vi.hoisted(() => ({
  listExternalSystems: vi.fn(),
  upsertTenantExternalSystem: vi.fn(async () => ({ key: 'custom:one' })),
  deleteTenantExternalSystem: vi.fn(async (key: string) => ({ key })),
}));

vi.mock('@alga-psa/tickets/actions/externalLinks/externalLinkActions', () => actionMocks);

const translations: Record<string, string> = {
  'ticketing.externalSystems.table.actions': 'Actions',
  'ticketing.externalSystems.actions.edit': 'Edit',
  'ticketing.externalSystems.actions.delete': 'Delete',
  'ticketing.externalSystems.actions.cancel': 'Cancel',
  'ticketing.externalSystems.actions.save': 'Save',
  'ticketing.externalSystems.fields.label': 'Label',
  'ticketing.externalSystems.fields.key': 'Key',
  'ticketing.externalSystems.fields.urlTemplate': 'URL template',
};

vi.mock('@alga-psa/ui/lib/i18n/client', () => {
  const translate = (key: string, fallback?: unknown) => {
    if (translations[key]) return translations[key];
    if (typeof fallback === 'string') return fallback;
    if (fallback && typeof fallback === 'object' && 'defaultValue' in fallback) {
      return (fallback as { defaultValue?: string }).defaultValue ?? key;
    }
    return key;
  };
  return {
    useTranslation: () => ({ t: translate, i18n: { language: 'en' } }),
    useFormatters: () => ({}),
    useI18n: () => ({ locale: 'en', t: translate, i18n: { language: 'en' } }),
    useOptionalI18n: () => ({ locale: 'en', t: translate, i18n: { language: 'en' } }),
  };
});

import ExternalSystemsSettings from './ExternalSystemsSettings';
import type { ExternalSystemOption } from '@alga-psa/tickets/actions/externalLinks/externalLinkActions';

function system(overrides: Partial<ExternalSystemOption> = {}): ExternalSystemOption {
  return {
    key: 'custom:one',
    label: 'One',
    icon: 'Link',
    originCategory: 'reference',
    isCustom: true,
    url_template: 'https://one.example/{external_id}',
    ...overrides,
  };
}

describe('ExternalSystemsSettings row actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders an accessible Actions control whose menu offers Edit and Delete', async () => {
    actionMocks.listExternalSystems.mockResolvedValue([system()]);
    const user = userEvent.setup();

    render(<ExternalSystemsSettings />);

    const actionsButton = await screen.findByRole('button', { name: 'Actions' });
    await user.click(actionsButton);

    expect(await screen.findByRole('menuitem', { name: 'Edit' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Delete' })).toBeInTheDocument();
  });

  it('targets the selected row, not the first row, when an action is chosen', async () => {
    actionMocks.listExternalSystems.mockResolvedValue([
      system({ key: 'custom:one', label: 'One', url_template: 'https://one.example/{external_id}' }),
      system({ key: 'custom:two', label: 'Two', url_template: 'https://two.example/{external_id}' }),
    ]);
    const user = userEvent.setup();

    render(<ExternalSystemsSettings />);

    await screen.findByText('Two');

    const twoActions = document.getElementById('external-system-actions-custom-two');
    if (!twoActions) throw new Error('Actions control for custom:two was not rendered');
    await user.click(twoActions);
    await user.click(await screen.findByRole('menuitem', { name: 'Delete' }));

    const confirm = await screen.findByRole('button', { name: 'Delete' });
    await user.click(confirm);

    await waitFor(() => expect(actionMocks.deleteTenantExternalSystem).toHaveBeenCalledTimes(1));
    expect(actionMocks.deleteTenantExternalSystem).toHaveBeenCalledWith('custom:two');
  });
});
