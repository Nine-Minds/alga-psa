// @vitest-environment jsdom
/// <reference types="@testing-library/jest-dom/vitest" />

import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
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

    expect(screen.getByText('This ticket already has an origin link.')).toBeInTheDocument();
  });
});
