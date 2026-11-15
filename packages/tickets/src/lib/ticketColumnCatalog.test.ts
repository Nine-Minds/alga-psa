import { describe, expect, it } from 'vitest';
import { TICKET_COLUMNS, resolveTicketColumnVisibility } from './ticketColumnCatalog';

describe('ticket column catalog: contact column', () => {
  it('is visible by default so a VIP requester badge is seen', () => {
    const contact = TICKET_COLUMNS.find((c) => c.key === 'contact');
    expect(contact?.defaultVisible).toBe(true);
    expect(resolveTicketColumnVisibility().contact).toBe(true);
  });

  it('lets a stored per-user preference override the default', () => {
    expect(resolveTicketColumnVisibility({ contact: false }).contact).toBe(false);
    expect(resolveTicketColumnVisibility({ contact: true }).contact).toBe(true);
  });
});
