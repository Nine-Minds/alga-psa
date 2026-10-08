// @vitest-environment node

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { createTicketColumns } from './ticket-columns';

function renderLastActivity(actor: unknown) {
  const columns = createTicketColumns({
    categories: [],
    boards: [],
    displaySettings: { list: { columnVisibility: { last_activity: true } } },
    onTicketClick: () => {},
    t: (_key: string, fallback: string) => fallback,
  } as any);
  const col = columns.find((c: any) => c.dataIndex === 'latest_activity_at') as any;
  expect(col).toBeTruthy();
  const record = { latest_activity_at: '2026-01-02T10:00:00.000Z', latest_activity_actor: actor };
  return renderToStaticMarkup(<>{col.render(record.latest_activity_at, record)}</>);
}

describe('Last Activity column actor line', () => {
  it('renders "by <name>" for a user actor', () => {
    expect(renderLastActivity({ kind: 'user', name: 'Ada Lovelace' })).toContain('by Ada Lovelace');
  });

  it('renders System for a system actor', () => {
    expect(renderLastActivity({ kind: 'system', name: null })).toContain('System');
  });

  it('omits the line when the actor is null or unnamed', () => {
    expect(renderLastActivity(null)).not.toContain('last-activity-actor');
    expect(renderLastActivity({ kind: 'user', name: null })).not.toContain('last-activity-actor');
  });
});
