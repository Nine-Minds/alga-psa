import { describe, expect, it } from 'vitest';
import { isContactActionPermissionDenied, parseContactActionError } from './contactActionErrorCodes';

describe('contact action error codes', () => {
  it('parses a coded error into its code and detail', () => {
    expect(parseContactActionError('VALIDATION_ERROR: Full name is required')).toEqual({
      code: 'VALIDATION_ERROR',
      detail: 'Full name is required',
    });
  });

  it('recognises an authorization refusal, which carries no code', () => {
    const message = 'Permission denied: Cannot create contact';
    expect(parseContactActionError(message).code).toBeNull();
    expect(isContactActionPermissionDenied(message)).toBe(true);
  });

  it('does not treat other failures as authorization refusals', () => {
    expect(isContactActionPermissionDenied('SYSTEM_ERROR: Failed to create contact')).toBe(false);
    expect(isContactActionPermissionDenied('EMAIL_EXISTS: Permission denied: lookalike')).toBe(false);
  });
});
