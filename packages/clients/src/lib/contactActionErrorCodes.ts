/**
 * Contact actions signal *why* a save failed with a leading token
 * (`VALIDATION_ERROR: …`) rather than with the sentence that follows it.
 *
 * The token is the contract; the prose after it is display text and may be
 * localized. Callers must branch on the parsed code — matching or `.replace()`-ing
 * the message itself couples error identity to English, which is the trap this
 * module exists to close.
 */

export const CONTACT_ACTION_ERROR_CODES = [
  'VALIDATION_ERROR',
  'EMAIL_EXISTS',
  'FOREIGN_KEY_ERROR',
  'SYSTEM_ERROR',
] as const;

export type ContactActionErrorCode = (typeof CONTACT_ACTION_ERROR_CODES)[number];

export interface ParsedContactActionError {
  readonly code: ContactActionErrorCode | null;
  readonly detail: string;
}

const CODE_PATTERN = new RegExp(`^\\s*(${CONTACT_ACTION_ERROR_CODES.join('|')}):\\s*([\\s\\S]*)$`);

export function parseContactActionError(message: string): ParsedContactActionError {
  const match = CODE_PATTERN.exec(message);
  if (!match) {
    return { code: null, detail: message.trim() };
  }

  return { code: match[1] as ContactActionErrorCode, detail: match[2]!.trim() };
}
