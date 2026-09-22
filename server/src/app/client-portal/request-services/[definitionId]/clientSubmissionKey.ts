/**
 * Hidden form-field name carrying the per-form-attempt idempotency key from
 * the rendered portal form to the submit server action. Prefixed so it can
 * never collide with administrator-authored form field keys.
 */
export const CLIENT_SUBMISSION_KEY_FIELD_NAME = '__algaClientSubmissionKey';
