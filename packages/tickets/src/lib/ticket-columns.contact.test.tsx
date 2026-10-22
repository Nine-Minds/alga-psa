// @vitest-environment node

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { createTicketColumns } from './ticket-columns';

function contactElement(
  record: Record<string, unknown>,
  onContactClick?: (contactNameId: string) => void,
) {
  const columns = createTicketColumns({
    categories: [],
    boards: [],
    displaySettings: { list: { columnVisibility: { contact: true } } },
    onTicketClick: () => {},
    onContactClick,
    t: (_key: string, fallback: string) => fallback,
  } as any);
  const col = columns.find((c: any) => c.dataIndex === 'contact_name') as any;
  expect(col).toBeTruthy();
  return col.render(record.contact_name, record) as React.ReactElement<any>;
}

function renderContact(record: Record<string, unknown>) {
  return renderToStaticMarkup(<>{contactElement(record)}</>);
}

describe('Contact column', () => {
  it('renders the contact avatar image when one is uploaded', () => {
    const markup = renderContact({
      contact_name: 'Grace Hopper',
      contact_name_id: 'contact-1',
      contact_avatar_url: 'https://example.test/grace.png',
    });
    expect(markup).toContain('https://example.test/grace.png');
    expect(markup).toContain('Grace Hopper avatar');
    expect(markup).toContain('Grace Hopper');
  });

  it('falls back to contact initials when there is no avatar image', () => {
    const markup = renderContact({
      contact_name: 'Grace Hopper',
      contact_name_id: 'contact-1',
      contact_avatar_url: null,
    });
    expect(markup).not.toContain('<img');
    expect(markup).toContain('GH');
    expect(markup).toContain('Grace Hopper');
  });

  it('renders a muted placeholder when the ticket has no contact', () => {
    const markup = renderContact({
      contact_name: null,
      contact_name_id: null,
      contact_avatar_url: null,
    });
    expect(markup).not.toContain('<img');
    expect(markup).toContain('—');
  });

  it('opens the contact quick view without selecting the row', () => {
    const onContactClick = vi.fn();
    const stopPropagation = vi.fn();
    const element = contactElement(
      { contact_name: 'Grace Hopper', contact_name_id: 'contact-1', contact_avatar_url: null },
      onContactClick,
    );

    expect(element.type).toBe('button');
    element.props.onClick({ stopPropagation });

    expect(stopPropagation).toHaveBeenCalled();
    expect(onContactClick).toHaveBeenCalledWith('contact-1');
  });

  it('stays unclickable when the ticket has no contact', () => {
    const onContactClick = vi.fn();
    const element = contactElement(
      { contact_name: null, contact_name_id: null, contact_avatar_url: null },
      onContactClick,
    );

    expect(element.type).not.toBe('button');
  });

  it('renders one combined VIP·POC badge with a full accessible label when both flags are set', () => {
    const markup = renderContact({
      contact_name: 'Smoke Portal 2270',
      contact_name_id: 'contact-1',
      contact_is_vip: true,
      contact_is_primary_contact: true,
    });
    expect(markup).toContain('data-testid="vip-poc-badge"');
    expect(markup).toContain('aria-label="VIP, Point of contact"');
    expect(markup).toContain('title="VIP, Point of contact"');
    expect(markup).toContain('VIP·POC');
    expect(markup).not.toContain('data-testid="vip-badge"');
    expect(markup).not.toContain('data-testid="poc-badge"');
  });

  it('renders a single regular badge for one flag and nothing for none', () => {
    const vipOnly = renderContact({ contact_name: 'G', contact_name_id: 'c', contact_is_vip: true, contact_is_primary_contact: false });
    expect(vipOnly).toContain('data-testid="vip-badge"');
    expect(vipOnly).not.toContain('poc-badge');
    expect(vipOnly).not.toContain('vip-poc-badge');

    const pocOnly = renderContact({ contact_name: 'G', contact_name_id: 'c', contact_is_vip: false, contact_is_primary_contact: true });
    expect(pocOnly).toContain('data-testid="poc-badge"');
    expect(pocOnly).not.toContain('data-testid="vip-badge"');

    const none = renderContact({ contact_name: 'G', contact_name_id: 'c', contact_is_vip: false, contact_is_primary_contact: false });
    expect(none).not.toContain('badge');
  });

  it('keeps the name readable and the badge wrapper inside the cell', () => {
    const markup = renderContact({
      contact_name: 'Grace Hopper',
      contact_name_id: 'contact-1',
      contact_is_vip: true,
      contact_is_primary_contact: true,
    });
    expect(markup).toContain('class="min-w-[6ch] truncate"');
    expect(markup).toMatch(/<span class="flex shrink-0 items-center gap-1">/);
    expect(markup).toContain('flex min-w-0 max-w-full items-center gap-2 overflow-hidden');
  });

  it('gives the contact column a pixel width so percent sizing cannot clip the flags', () => {
    const columns = createTicketColumns({
      categories: [], boards: [],
      displaySettings: { list: { columnVisibility: { contact: true } } },
      onTicketClick: () => {},
      t: (_k: string, f: string) => f,
    } as any);
    const col = columns.find((c: any) => c.dataIndex === 'contact_name') as any;
    expect(col.width).toBe('200px');
  });
});

describe('Client column VIP badge', () => {
  it('renders the VIP badge for a VIP client and none otherwise', () => {
    const columns = createTicketColumns({
      categories: [], boards: [],
      displaySettings: { list: { columnVisibility: { client: true } } },
      onTicketClick: () => {},
      t: (_k: string, f: string) => f,
    } as any);
    const col = columns.find((c: any) => c.dataIndex === 'client_name') as any;
    expect(col).toBeTruthy();
    const vip = renderToStaticMarkup(<>{col.render('Wonderland', { client_name: 'Wonderland', client_id: 'cl1', client_is_vip: true })}</>);
    expect(vip).toContain('data-testid="vip-badge"');
    expect(vip).toContain('class="min-w-[6ch] truncate"');
    expect(vip).toContain('flex min-w-0 max-w-full items-center gap-2 overflow-hidden');
    const plain = renderToStaticMarkup(<>{col.render('Wonderland', { client_name: 'Wonderland', client_id: 'cl1', client_is_vip: false })}</>);
    expect(plain).not.toContain('vip-badge');
  });
});
