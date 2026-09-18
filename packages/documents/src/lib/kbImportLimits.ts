/**
 * Upload caps for the KB article import, shared by the dialog (fail fast in the
 * browser) and the server action (the authoritative check). Kept out of the
 * 'use server' action module, which may only export async functions.
 */

/**
 * Next's server-action bodySizeLimit (SERVER_ACTIONS_BODY_LIMIT, default 20mb).
 * Duplicated here because next.config.mjs is not importable from a client
 * bundle; the caps below only need the default's order of magnitude.
 */
const SERVER_ACTION_BODY_LIMIT_BYTES = 20 * 1024 * 1024;

export const KB_IMPORT_MAX_FILES = 20;
export const KB_IMPORT_MAX_FILE_BYTES = 5 * 1024 * 1024;
/**
 * Measured on the raw file bytes, while the request body carries the same text
 * JSON-escaped inside the action payload. Escaping can double a worst-case file
 * (every byte a quote, backslash or control character), so the batch cap sits at
 * half the transport limit: a batch the dialog accepts always fits through Next,
 * instead of being rejected before startArticleImport runs with nothing but a
 * generic "Import failed" toast to show for it.
 */
export const KB_IMPORT_MAX_TOTAL_BYTES = SERVER_ACTION_BODY_LIMIT_BYTES / 2;
export const KB_IMPORT_ALLOWED_EXTENSIONS = ['.md', '.markdown', '.html', '.htm'];
