/**
 * Upload caps for the KB article import, shared by the dialog (fail fast in the
 * browser) and the server action (the authoritative check). Kept out of the
 * 'use server' action module, which may only export async functions.
 */

export const KB_IMPORT_MAX_FILES = 20;
export const KB_IMPORT_MAX_FILE_BYTES = 5 * 1024 * 1024;
/**
 * Its own limit, deliberately not derived from the body cap (a client bundle cannot read it).
 * Measured on the raw file bytes, while the request body carries the same text
 * JSON-escaped inside the action payload. Escaping can double a worst-case file
 * (every byte a quote, backslash or control character), so the batch cap sits at
 * half of 20 MiB: a batch the dialog accepts always fits through Next's server-action body
 * cap (SERVER_ACTIONS_BODY_LIMIT, default 26mb; pinned by serverActionsBodyLimit.test.ts),
 * instead of being rejected before startArticleImport runs with nothing but a
 * generic "Import failed" toast to show for it.
 */
export const KB_IMPORT_MAX_TOTAL_BYTES = 10 * 1024 * 1024;
export const KB_IMPORT_ALLOWED_EXTENSIONS = ['.md', '.markdown', '.html', '.htm'];
