/**
 * Shared tag-text rules. `createTag` and the CSV tag writer both validate
 * through here so the length limit and the allowed-character set exist once.
 */

export const TAG_TEXT_MAX_LENGTH = 50;

// Letters, numbers, spaces and common punctuation.
const TAG_TEXT_ALLOWED_CHARACTERS = /^[a-zA-Z0-9\-_\s!@#$%^&*()+=\][{};':",./<>?]+$/;

export type TagTextValidationFailure = {
  valid: false;
  message: string;
  i18nKey: string;
};

export type TagTextValidationResult =
  | { valid: true; text: string }
  | TagTextValidationFailure;

/** Validates a raw tag text. The returned `text` is trimmed. */
export function validateTagText(raw: string | null | undefined): TagTextValidationResult {
  const text = (raw ?? '').trim();

  if (!text) {
    return { valid: false, message: 'Tag text is required', i18nKey: 'common:errors.tags.textRequired' };
  }

  if (text.length > TAG_TEXT_MAX_LENGTH) {
    return {
      valid: false,
      message: `Tag text too long (max ${TAG_TEXT_MAX_LENGTH} characters)`,
      i18nKey: 'common:errors.tags.textTooLong',
    };
  }

  if (!TAG_TEXT_ALLOWED_CHARACTERS.test(text)) {
    return {
      valid: false,
      message: 'Tag text contains invalid characters',
      i18nKey: 'common:errors.tags.textInvalidCharacters',
    };
  }

  return { valid: true, text };
}
