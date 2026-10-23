import { describe, expect, it } from 'vitest';
import {
  resolveTicketRequesterLabel,
  resolveTicketSubjectLabel,
  usableDisplayName,
} from '../ticketRequesterDisplay';

const ticketId = '3ca189ae-1111-4222-8333-444455556666';

describe('ticket requester display', () => {
  it('prefers contact, then sender email, then client for "from"', () => {
    expect(resolveTicketRequesterLabel({ contactName: 'Ada', senderEmail: 'a@x.test', clientName: 'Acme' })).toBe('Ada');
    expect(resolveTicketRequesterLabel({ senderEmail: 'a@x.test', clientName: 'Acme' })).toBe('a@x.test');
    expect(resolveTicketRequesterLabel({ clientName: 'Acme' })).toBe('Acme');
  });

  it('email ticket with no contact and no client falls back to the sender email', () => {
    expect(resolveTicketRequesterLabel({ contactName: null, clientName: null, senderEmail: 'who@x.test' })).toBe('who@x.test');
    expect(resolveTicketSubjectLabel({ contactName: null, clientName: null, senderEmail: 'who@x.test' })).toBe('who@x.test');
  });

  it('portal ticket with a contact but an unmatched client names the contact', () => {
    expect(resolveTicketSubjectLabel({ clientName: null, contactName: 'Grace', senderEmail: 'g@x.test' })).toBe('Grace');
  });

  it('never treats an id or blank as a name', () => {
    expect(usableDisplayName(ticketId)).toBeNull();
    expect(usableDisplayName('   ')).toBeNull();
    expect(resolveTicketRequesterLabel({ contactName: ticketId, clientName: '', senderEmail: undefined })).toBeNull();
  });
});
