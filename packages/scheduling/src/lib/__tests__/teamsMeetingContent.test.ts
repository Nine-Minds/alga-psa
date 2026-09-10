import { describe, expect, it } from 'vitest';
import { ensureCreatorAttendee } from '../teamsMeetingContent';

const creator = { email: 'dorothy@kansas.oz', first_name: 'Dorothy', last_name: 'Gale', username: 'dorothy' };

describe('ensureCreatorAttendee', () => {
  it('appends the creator with their display name when absent', () => {
    const result = ensureCreatorAttendee(
      [{ emailAddress: { address: 'wanda@external.test', name: 'Wanda' } }],
      creator,
    );
    expect(result).toHaveLength(2);
    expect(result[1]).toEqual({
      emailAddress: { address: 'dorothy@kansas.oz', name: 'Dorothy Gale' },
      type: 'required',
    });
  });

  it('does not duplicate the creator (case-insensitive address match)', () => {
    const result = ensureCreatorAttendee(
      [{ emailAddress: { address: 'Dorothy@Kansas.OZ', name: 'D.' } }],
      creator,
    );
    expect(result).toHaveLength(1);
  });

  it('returns the list untouched when the creator has no email', () => {
    const attendees = [{ emailAddress: { address: 'wanda@external.test' } }];
    expect(ensureCreatorAttendee(attendees, { email: '  ' })).toBe(attendees);
  });

  it('falls back to username then email for the display name', () => {
    const viaUsername = ensureCreatorAttendee([], { email: 'g@oz.test', username: 'glinda' });
    expect(viaUsername[0].emailAddress.name).toBe('glinda');
    const viaEmail = ensureCreatorAttendee([], { email: 'g@oz.test' });
    expect(viaEmail[0].emailAddress.name).toBe('g@oz.test');
  });
});
