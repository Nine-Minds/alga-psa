import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveTicketCallPhone } from './ticketCallPhone';

describe('ticket Bento call phone', () => {
  it('prefers the contact default and falls through to location then client phone', () => {
    expect(resolveTicketCallPhone({
      contact: {
        default_phone_number: '+15550000001',
        phone_numbers: [{ phone_number: '+15550000002' }],
      },
      locationPhone: '+15550000003',
      clientPhone: '+15550000004',
    })).toBe('+15550000001');

    expect(resolveTicketCallPhone({
      contact: null,
      locationPhone: '+375291234567',
      clientPhone: '+15550000004',
    })).toBe('+375291234567');

    expect(resolveTicketCallPhone({
      contact: null,
      locationPhone: null,
      clientPhone: '+15550000004',
    })).toBe('+15550000004');
  });

  it('wires the resolved phone through CallLink and the connected Teams Call action', () => {
    const source = fs.readFileSync(path.resolve(__dirname, './TicketBentoLayout.tsx'), 'utf8');
    expect(source).toContain('<CallLink');
    expect(source).toContain('phoneNumber={contactPhone}');
    expect(source).toContain('callIntent={ticketId ? { ticketId } : undefined}');
    expect(source).toContain('callPhoneNumber={contactPhone}');
  });
});
