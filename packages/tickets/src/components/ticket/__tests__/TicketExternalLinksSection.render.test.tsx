// @vitest-environment jsdom
/// <reference types="@testing-library/jest-dom/vitest" />

import React from 'react';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const actionMocks = vi.hoisted(() => ({
  getTicketExternalLinks: vi.fn(async () => []),
  addExternalLink: vi.fn(async () => ({ link_id: 'new-link' })),
  updateExternalLink: vi.fn(async () => ({ link_id: 'l1' })),
  removeExternalLink: vi.fn(async () => ({ link_id: 'l1' })),
  listExternalSystems: vi.fn(async () => []),
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

import { TicketExternalLinksSection } from '../TicketExternalLinksSection';
import type { ITicketExternalLinkView } from '../../../actions/externalLinks/externalLinkActions';

function link(overrides: Partial<ITicketExternalLinkView> = {}): ITicketExternalLinkView {
  return {
    link_id: 'l1',
    ticket_id: 't1',
    entity_type: 'ticket',
    entity_id: 't1',
    system: 'github',
    external_id: '42',
    external_parent_id: null,
    realm: 'Nine-Minds/alga-psa',
    url: null,
    relationship: 'origin',
    actor: { handle: 'octocat' },
    external_status: null,
    external_updated_at: null,
    last_synced_at: null,
    metadata: null,
    created_at: null,
    updated_at: null,
    display: {
      label: 'GitHub',
      icon: 'Github',
      href: 'https://github.com/Nine-Minds/alga-psa/issues/42',
      realmLabel: 'Repository',
    },
    ...overrides,
  };
}

describe('TicketExternalLinksSection behaviour', () => {
  // Radix Select uses browser APIs that jsdom does not implement.
  const browserMethods = ['hasPointerCapture', 'setPointerCapture', 'releasePointerCapture', 'scrollIntoView'] as const;
  const originalDescriptors = browserMethods.map((name) => Object.getOwnPropertyDescriptor(Element.prototype, name));
  beforeAll(() => {
    for (const name of browserMethods) {
      Object.defineProperty(Element.prototype, name, { configurable: true, value: vi.fn(() => false) });
    }
  });
  afterAll(() => {
    browserMethods.forEach((name, index) => {
      const descriptor = originalDescriptors[index];
      if (descriptor) Object.defineProperty(Element.prototype, name, descriptor);
      else Reflect.deleteProperty(Element.prototype, name);
    });
  });

  beforeEach(() => {
    vi.clearAllMocks();
    actionMocks.listExternalSystems.mockResolvedValue([]);
  });

  it('T130: renders system identity, readable reference, actor, and a safe link-out', () => {
    render(
      <TicketExternalLinksSection
        id="ticket-external-links"
        ticketId="t1"
        initialLinks={[link()]}
      />,
    );

    expect(screen.getByText('GitHub')).toBeInTheDocument();
    expect(screen.getByText('Nine-Minds/alga-psa/42')).toBeInTheDocument();
    expect(screen.getByText('@octocat')).toBeInTheDocument();

    const anchor = screen.getByRole('link');
    expect(anchor).toHaveAttribute('href', 'https://github.com/Nine-Minds/alga-psa/issues/42');
    expect(anchor).toHaveAttribute('target', '_blank');
    expect(anchor).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('T131: shows the no-URL fallback without inventing a link when no href resolves', () => {
    render(
      <TicketExternalLinksSection
        id="ticket-external-links"
        ticketId="t1"
        initialLinks={[link({ display: { label: 'Vendor', icon: 'Link', href: null, realmLabel: null } })]}
      />,
    );

    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.getByText('Vendor')).toBeInTheDocument();
  });

  it('T132: the add dialog warns when the ticket already has an origin link', async () => {
    const user = userEvent.setup();
    render(
      <TicketExternalLinksSection
        id="ticket-external-links"
        ticketId="t1"
        initialLinks={[link()]}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Add link' }));

    expect(screen.getByText(/This ticket already has an origin link\.$/)).toBeInTheDocument();
    await user.click(document.getElementById('ticket-external-links-relationship')!);
    expect(screen.getByRole('option', { name: 'origin' })).toHaveAttribute('aria-disabled', 'true');
  });

  async function openEdit(initial: ITicketExternalLinkView) {
    const user = userEvent.setup();
    render(
      <TicketExternalLinksSection
        id="ticket-external-links"
        ticketId="t1"
        initialLinks={[initial]}
      />,
    );
    await user.click(document.getElementById(`ticket-external-links-actions-${initial.link_id}`)!);
    await user.click(await screen.findByText('Edit'));
    return user;
  }

  it('allows changing the existing origin relationship and selecting origin again before saving', async () => {
    const user = await openEdit(link());

    await user.click(document.getElementById('ticket-external-links-relationship')!);
    await user.click(screen.getByRole('option', { name: 'reference' }));
    expect(document.getElementById('ticket-external-links-relationship')).toHaveTextContent(/^reference$/);
    expect(screen.queryByText(/This ticket already has an origin link\.$/)).not.toBeInTheDocument();

    await user.click(document.getElementById('ticket-external-links-relationship')!);
    expect(screen.getByRole('option', { name: 'origin' })).not.toHaveAttribute('aria-disabled', 'true');
    await user.click(screen.getByRole('option', { name: 'origin' }));
    expect(document.getElementById('ticket-external-links-relationship')).toHaveTextContent(/^origin$/);
    await user.click(document.getElementById('ticket-external-links-dialog-save')!);

    await waitFor(() => expect(actionMocks.updateExternalLink).toHaveBeenCalledWith(
      'l1', expect.objectContaining({ relationship: 'origin' }),
    ));
  });

  it('T133: editing preserves actor id and url alongside the edited handle/display name', async () => {
    const user = await openEdit(
      link({
        actor: {
          id: 'user-1',
          handle: 'octocat',
          display_name: 'The Octocat',
          url: 'https://github.com/octocat',
        },
      }),
    );

    const urlInput = document.getElementById('ticket-external-links-url') as HTMLInputElement;
    await user.clear(urlInput);
    await user.type(urlInput, 'https://github.com/Nine-Minds/alga-psa/issues/43');
    await user.click(document.getElementById('ticket-external-links-dialog-save')!);

    await waitFor(() => expect(actionMocks.updateExternalLink).toHaveBeenCalledTimes(1));
    expect(actionMocks.updateExternalLink).toHaveBeenCalledWith(
      'l1',
      expect.objectContaining({
        url: 'https://github.com/Nine-Minds/alga-psa/issues/43',
        actor: {
          id: 'user-1',
          handle: 'octocat',
          display_name: 'The Octocat',
          url: 'https://github.com/octocat',
        },
      }),
    );
  });

  it('T134: editing preserves an actor that carries only id and url', async () => {
    const user = await openEdit(
      link({ actor: { id: 'user-2', url: 'https://sso.example/user-2' } }),
    );

    // The dialog has no handle/display to edit, but saving must not drop id/url.
    await user.click(document.getElementById('ticket-external-links-dialog-save')!);

    await waitFor(() => expect(actionMocks.updateExternalLink).toHaveBeenCalledTimes(1));
    expect(actionMocks.updateExternalLink).toHaveBeenCalledWith(
      'l1',
      expect.objectContaining({
        actor: {
          handle: null,
          display_name: null,
          id: 'user-2',
          url: 'https://sso.example/user-2',
        },
      }),
    );
  });
});
