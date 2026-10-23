import { describe, expect, it } from 'vitest';

import { UserFacingError, actionError, permissionError, userFacingErrorMessage } from './errorHandling';

const FALLBACK = 'Failed to load ticket details';

describe('userFacingErrorMessage', () => {
  it('returns the text of a returned action error payload', () => {
    expect(userFacingErrorMessage(actionError('Ticket not found or access denied'), FALLBACK)).toBe(
      'Ticket not found or access denied',
    );
    expect(userFacingErrorMessage({ actionError: 'Nope' }, FALLBACK)).toBe('Nope');
  });

  it('returns the text of a returned permission error payload', () => {
    expect(userFacingErrorMessage(permissionError('Permission denied: Cannot read tickets'), FALLBACK)).toBe(
      'Permission denied: Cannot read tickets',
    );
  });

  it('returns the message of a UserFacingError', () => {
    const error = new UserFacingError('Could not add the payment method');
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('UserFacingError');
    expect(userFacingErrorMessage(error, FALLBACK)).toBe('Could not add the payment method');
  });

  it('returns the fallback for an ordinary Error, even one carrying SQL-like text', () => {
    const error = new Error(
      'select "t".* from "tickets" as "t" where "t"."ticket_id" = $1 - invalid input syntax for type uuid: "T-1"',
    );
    expect(userFacingErrorMessage(error, FALLBACK)).toBe(FALLBACK);
    expect(userFacingErrorMessage(new TypeError('boom'), FALLBACK)).toBe(FALLBACK);
  });

  it('returns the fallback for strings, null, undefined and unrelated objects', () => {
    expect(userFacingErrorMessage('select * from tickets', FALLBACK)).toBe(FALLBACK);
    expect(userFacingErrorMessage(null, FALLBACK)).toBe(FALLBACK);
    expect(userFacingErrorMessage(undefined, FALLBACK)).toBe(FALLBACK);
    expect(userFacingErrorMessage({ message: 'select 1' }, FALLBACK)).toBe(FALLBACK);
  });
});
