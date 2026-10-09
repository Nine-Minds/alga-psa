// @vitest-environment node

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { createTicketColumns } from './ticket-columns';

function renderContact(record: Record<string, unknown>) {
  const columns = createTicketColumns({
    categories: [],
    boards: [],
    displaySettings: { list: { columnVisibility: { contact: true } } },
    onTicketClick: () => {},
    t: (_key: string, fallback: string) => fallback,
  } as any);
  const col = columns.find((c: any) => c.dataIndex === 'contact_name') as any;
  expect(col).toBeTruthy();
  return renderToStaticMarkup(<>{col.render(record.contact_name, record)}</>);
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
});
