// @vitest-environment node

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { createTicketColumns } from './ticket-columns';
import { TICKET_COLUMNS } from './ticketColumnCatalog';

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

  it('opens the contact quick view through the chip click-through', () => {
    const onContactClick = vi.fn();
    const element = contactElement(
      { contact_name: 'Grace Hopper', contact_name_id: 'contact-1', contact_avatar_url: null },
      onContactClick,
    );

    element.props.onClick();
    expect(onContactClick).toHaveBeenCalledWith('contact-1');
  });

  it('stays unclickable when the ticket has no contact', () => {
    const onContactClick = vi.fn();
    const element = contactElement(
      { contact_name: null, contact_name_id: null, contact_avatar_url: null },
      onContactClick,
    );

    expect(element.props.onClick).toBeUndefined();
  });

  it('renders the row contact tags as chip badges, at most two inline with +n for the rest', () => {
    const tag = (id: string, text: string) => ({ tag_id: id, tag_text: text, background_color: null, text_color: null });
    const markup = renderContact({
      contact_name: 'Grace Hopper',
      contact_name_id: 'contact-1',
      contact_tags: [tag('1', 'VIP'), tag('2', 'Billing'), tag('3', 'Escalation')],
    });
    expect(markup).toContain('VIP');
    expect(markup).toContain('Billing');
    expect(markup).not.toContain('>Escalation<');
    expect(markup).toContain('+1');
  });

  it('is visible by default in the column catalog', () => {
    expect(TICKET_COLUMNS.find((column) => column.key === 'contact')?.defaultVisible).toBe(true);
  });
});

describe('Client column', () => {
  it('renders the row client tags as chip badges', () => {
    const columns = createTicketColumns({
      categories: [],
      boards: [],
      displaySettings: { list: { columnVisibility: { client: true } } },
      onTicketClick: () => {},
      t: (_key: string, fallback: string) => fallback,
    } as any);
    const col = columns.find((c: any) => c.dataIndex === 'client_name') as any;
    const record = {
      client_id: 'c1',
      client_name: 'Acme',
      client_tags: [{ tag_id: '1', tag_text: 'VIP', background_color: null, text_color: null }],
    };
    const markup = renderToStaticMarkup(<>{col.render(record.client_name, record)}</>);
    expect(markup).toContain('Acme');
    expect(markup).toContain('VIP');
  });
});
