/**
 * The three-layer result shape shared by every client/contact field validator:
 *
 *   input → normalize → validate (structural, blocking) → advise (plausibility, never blocks)
 *
 * `error` is the only thing that may gate a save. `warnings` are opinions.
 */

export interface ValidationMessage {
  /** Stable i18n key, e.g. `clients.validation.clientName.required`. */
  key: string;
  /** English text used when no translator is wired up. */
  defaultValue: string;
  params?: Record<string, unknown>;
}

export interface FieldValidation {
  /** Normalized value — what should actually be stored. */
  value: string;
  /** English text of the blocking error, or null. */
  error: string | null;
  /** Never blocks a save. English text. */
  warnings: string[];
  /** Structured forms of the above, for translation at the UI edge. */
  errorMessage: ValidationMessage | null;
  warningMessages: ValidationMessage[];
}

export type Translator = (key: string, options?: Record<string, unknown>) => string;

export function message(
  key: string,
  defaultValue: string,
  params?: Record<string, unknown>
): ValidationMessage {
  return params ? { key, defaultValue, params } : { key, defaultValue };
}

/** i18next-style `{{param}}` interpolation, used when no translator is wired up. */
export function interpolate(template: string, params?: Record<string, unknown>): string {
  if (!params) {
    return template;
  }
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, key: string) =>
    key in params ? String(params[key]) : match
  );
}

export function translateMessage(msg: ValidationMessage, t?: Translator): string {
  if (!t) {
    return interpolate(msg.defaultValue, msg.params);
  }
  return t(msg.key, { defaultValue: msg.defaultValue, ...(msg.params ?? {}) });
}

export function buildFieldValidation(
  value: string,
  errorMessage: ValidationMessage | null,
  warningMessages: ValidationMessage[] = []
): FieldValidation {
  return {
    value,
    error: errorMessage ? translateMessage(errorMessage) : null,
    warnings: warningMessages.map((warning) => translateMessage(warning)),
    errorMessage,
    warningMessages,
  };
}

/** Resolve a result's messages through an i18n translator. */
export function translateFieldValidation(
  result: FieldValidation,
  t?: Translator
): FieldValidation {
  return {
    ...result,
    error: result.errorMessage ? translateMessage(result.errorMessage, t) : null,
    warnings: result.warningMessages.map((warning) => translateMessage(warning, t)),
  };
}
