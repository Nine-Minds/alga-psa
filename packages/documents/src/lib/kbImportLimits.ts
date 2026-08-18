/**
 * Upload caps for the KB article import, shared by the dialog (fail fast in the
 * browser) and the server action (the authoritative check). Kept out of the
 * 'use server' action module, which may only export async functions.
 */
export const KB_IMPORT_MAX_FILES = 20;
export const KB_IMPORT_MAX_FILE_BYTES = 5 * 1024 * 1024;
export const KB_IMPORT_MAX_TOTAL_BYTES = 20 * 1024 * 1024;
export const KB_IMPORT_ALLOWED_EXTENSIONS = ['.md', '.markdown', '.html', '.htm'];
