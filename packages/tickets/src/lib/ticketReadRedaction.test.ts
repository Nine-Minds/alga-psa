import { describe, expect, it } from 'vitest';
import { ticketReadFieldHidden, ticketReadMask, redactTicketReadPayload } from './ticketReadRedaction';

describe('ticket read redaction paths', () => {
  it.each(['users.first_name', 'users.last_name'])('hides both ticket display names for %s', (field) => {
    expect(ticketReadFieldHidden([field], 'assigned_to_name')).toBe(true);
    expect(ticketReadFieldHidden([field], 'entered_by_name')).toBe(true);
    expect(redactTicketReadPayload({
      assigned_to: 'assigned-id',
      assigned_to_name: 'Assigned Person',
      entered_by: 'enterer-id',
      entered_by_name: 'Entering Person',
      title: 'Readable title',
    }, [field])).toMatchObject({
      assigned_to: 'assigned-id',
      assigned_to_name: null,
      entered_by: 'enterer-id',
      entered_by_name: null,
      title: 'Readable title',
    });
  });

  it('keeps category and location display dependencies masked', () => {
    expect(ticketReadFieldHidden(['category_id'], 'category_name')).toBe(true);
    expect(ticketReadFieldHidden(['location_id'], 'location_name')).toBe(true);
  });

  it.each(['ticket_number', 'tickets.ticket_number', 'fields.ticket_number', 'values.ticket_number'])(
    'suppresses the ticket when identity path %s is restricted',
    (field) => expect(ticketReadMask([field]).dropResource).toBe(true),
  );

  it.each(['title', 'fields.title', 'values.title'])('normalizes supported field path %s', (field) => {
    expect(ticketReadMask([field]).dropResource).toBe(false);
    expect(ticketReadFieldHidden([field], 'title')).toBe(true);
    expect(ticketReadFieldHidden([field], 'description')).toBe(false);
    expect(redactTicketReadPayload({ title: 'Secret', description: 'Permitted' }, [field])).toMatchObject({
      title: 'Restricted ticket',
      description: 'Permitted',
    });
  });

  it('uses exact aliases from the shared projector for non-list spellings', () => {
    expect(ticketReadMask(['fields.clientName']).dropResource).toBe(false);
    expect(ticketReadFieldHidden(['fields.clientName'], 'client_name')).toBe(true);
    expect(ticketReadMask(['fields.clientName.future']).dropResource).toBe(true);
  });

  it.each(['mystery.title', 'title.unknown', 'fields.mystery.title', 'values.mystery.title', 'FIELDS.title', '*'])(
    'fails closed for unsupported or whole-resource path %s',
    (field) => expect(ticketReadMask([field]).dropResource).toBe(true),
  );
});
