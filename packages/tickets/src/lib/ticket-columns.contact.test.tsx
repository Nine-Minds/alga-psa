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
});
