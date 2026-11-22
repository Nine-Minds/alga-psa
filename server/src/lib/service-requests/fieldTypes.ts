/**
 * The field types the basic form builder supports, in one dependency-free module so the authoring
 * validator (basicFormBuilder.ts), the client-portal form (a Next client component) and the
 * submission service agree on what a requester can answer. Must not import knex or `@alga-psa/db`.
 */
export const SUPPORTED_BASIC_FORM_FIELD_TYPES = [
  'short-text',
  'long-text',
  'select',
  'checkbox',
  'date',
  'file-upload',
  'lookup',
] as const;

export type BasicFormFieldType = (typeof SUPPORTED_BASIC_FORM_FIELD_TYPES)[number];

const SUPPORTED = new Set<string>(SUPPORTED_BASIC_FORM_FIELD_TYPES);

export function isSupportedBasicFormFieldType(type: unknown): type is BasicFormFieldType {
  return typeof type === 'string' && SUPPORTED.has(type);
}

/**
 * A published field whose type this build does not know (a version published while the publish-time
 * type check was unreachable). The portal draws it as an inert "not available" row, so it can hold
 * no answer: it is never required and never stored. A field with no `type` at all is the portal's
 * plain-text fallback and is not unsupported here.
 */
export function isUnsupportedPublishedFieldType(type: unknown): boolean {
  return type !== undefined && !isSupportedBasicFormFieldType(type);
}
