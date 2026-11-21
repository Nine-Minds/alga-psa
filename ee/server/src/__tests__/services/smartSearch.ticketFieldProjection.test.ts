import { describe, expect, it } from 'vitest';
import { interpretTicketRedactions, projectTicketRow } from '@alga-psa/tickets/lib/ticketFieldProjection';

describe('ticket field redaction interpretation', () => {
  it('keeps built-in title and status while removing same-named restricted attributes', () => {
    const attributes = {
      title: 'restricted JSON title',
      status_id: 'restricted JSON status',
      permitted: 'visible attribute',
    };
    const interpretation = interpretTicketRedactions(
      ['attributes.title', 'attributes.status_id'],
      attributes,
    );

    const row = projectTicketRow({
      ticket_id: 'ticket-1',
      title: 'permitted built-in title',
      status_name: 'permitted built-in status',
      attributes,
    }, ['attributes.title', 'attributes.status_id'], interpretation);

    expect(row).toMatchObject({
      title: 'permitted built-in title',
      status_name: 'permitted built-in status',
      attributes: { permitted: 'visible attribute' },
    });
    expect(row?.attributes).not.toHaveProperty('title');
    expect(row?.attributes).not.toHaveProperty('status_id');
    expect(interpretation.hiddenFields).not.toContain('title');
    expect(interpretation.hiddenFields).not.toContain('status_id');
  });
});
