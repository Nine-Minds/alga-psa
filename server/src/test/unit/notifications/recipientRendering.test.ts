import { describe, expect, it } from 'vitest';
import { recipientRendering, type TicketNotificationRecipient } from '@alga-psa/shared/lib/notificationAudience';

const notSeat: TicketNotificationRecipient = { seat: false };
const seatInScope: TicketNotificationRecipient = { seat: true, userId: 'u1', reader: { kind: 'seat', tenant: 't1', clientId: 'c1' } };
const seatOutOfScope: TicketNotificationRecipient = { seat: true, userId: 'u1', reader: { kind: 'requester', tenant: 't1' } };

describe('recipientRendering', () => {
  it('follows who the send path addressed', () => {
    expect(recipientRendering(notSeat, 'msp')).toBe('msp');
    expect(recipientRendering(notSeat, 'client')).toBe('client');
  });

  it('defaults to staff when the send path says nothing', () => {
    expect(recipientRendering(notSeat)).toBe('msp');
  });

  it('gives an out-of-scope seat technician the client rendering however they were addressed', () => {
    expect(recipientRendering(seatOutOfScope, 'msp')).toBe('client');
    expect(recipientRendering(seatOutOfScope, 'client')).toBe('client');
  });

  it('keeps an in-scope seat technician on the rendering they were addressed with', () => {
    expect(recipientRendering(seatInScope, 'msp')).toBe('msp');
    expect(recipientRendering(seatInScope, 'client')).toBe('client');
  });
});
