// @vitest-environment jsdom
/// <reference types="@testing-library/jest-dom/vitest" />

import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const actionMocks = vi.hoisted(() => ({
  getTicketExternalLinks: vi.fn(async () => []),
  addExternalLink: vi.fn(async () => ({ link_id: 'new-link' })),
  updateExternalLink: vi.fn(async () => ({ link_id: 'l1' })),
  removeExternalLink: vi.fn(async () => ({ link_id: 'l1' })),
  listExternalSystems: vi.fn(async () => [] as any[]),
}));

vi.mock('../../../actions/externalLinks/externalLinkActions', () => actionMocks);

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({
    t: (key: string, fallbackOrOptions?: string | { defaultValue?: string }) => {
      if (typeof fallbackOrOptions === 'string') {
        return fallbackOrOptions;
      }
      if (fallbackOrOptions && typeof fallbackOrOptions === 'object') {
        return fallbackOrOptions.defaultValue ?? key;
      }
      return key;
    },
  }),
}));

// Drive the dialog's CustomSelect with a native select so the test exercises the
// section's own realm-visibility and preview logic without Radix portal timing.
vi.mock('@alga-psa/ui/components/CustomSelect', () => ({
  default: ({ id, options, value, onValueChange, disabled, placeholder }: any) => (
    <select
      id={id}
      data-testid={id}
      value={value ?? ''}
      disabled={disabled}
      aria-label={id}
      onChange={(event) => onValueChange(event.target.value)}
    >
      <option value="">{placeholder ?? ''}</option>
      {(options ?? [])
        .filter((option: any) => !option.disabled)
        .map((option: any) => (
          <option key={option.value} value={option.value}>
            {typeof option.label === 'string' ? option.label : option.value}
          </option>
        ))}
    </select>
  ),
}));

import { TicketExternalLinksSection } from '../TicketExternalLinksSection';

const CUSTOM_TEMPLATE = 'https://vendor.example/{realm}/cases/{external_id}';

describe('TicketExternalLinksSection custom-system realm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    actionMocks.listExternalSystems.mockResolvedValue([
      {
        key: 'custom:vendor',
        label: 'Vendor',
        icon: 'Link',
        urlTemplate: CUSTOM_TEMPLATE,
        realmLabel: undefined,
        originCategory: 'other',
        isCustom: true,
        url_template: CUSTOM_TEMPLATE,
      },
    ]);
  });

  it('T135: a custom {realm} template shows a fallback realm field, previews, and creates', async () => {
    const user = userEvent.setup();
    render(<TicketExternalLinksSection id="section" ticketId="t1" initialLinks={[]} />);

    await user.click(document.getElementById('section-add-button')!);

    const systemSelect = await screen.findByTestId('section-system');
    await waitFor(() => expect(screen.getByRole('option', { name: 'Vendor' })).toBeTruthy());
    await user.selectOptions(systemSelect, 'custom:vendor');

    // The definition declares no realmLabel, but the template needs {realm},
    // so the translated fallback field appears.
    await waitFor(() => expect(screen.getByText('Realm')).toBeInTheDocument());
    const realmInput = screen.getByLabelText('Realm');

    await user.type(realmInput, 'acme');
    await user.type(document.getElementById('section-external-id') as HTMLInputElement, '123');

    await waitFor(() =>
      expect(screen.getByText('https://vendor.example/acme/cases/123')).toBeInTheDocument(),
    );

    await user.click(document.getElementById('section-dialog-save')!);

    await waitFor(() => expect(actionMocks.addExternalLink).toHaveBeenCalledTimes(1));
    expect(actionMocks.addExternalLink).toHaveBeenCalledWith(
      expect.objectContaining({
        ticket_id: 't1',
        entity_type: 'ticket',
        system: 'custom:vendor',
        external_id: '123',
        realm: 'acme',
      }),
    );
  });
});
