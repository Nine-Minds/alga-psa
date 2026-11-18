/**
 * URL shapes of the public, session-less quote review (alga-2026-0002820).
 *
 * Public by exact shape, not by prefix: a 43-char base64url token (mirrors
 * QUOTE_ACCESS_TOKEN_LENGTH in @alga-psa/billing; middleware is Edge so it
 * cannot import the Node service) and nothing after it except, for the API, the
 * fixed `/pdf` and `/decision` leaves. Pure and Edge-safe: shared by middleware and the RSC layer.
 *
 * Group 1 of each pattern is the token.
 */
export const PUBLIC_QUOTE_PAGE_PATTERN = /^\/quote\/([A-Za-z0-9_-]{43})$/;
export const PUBLIC_QUOTE_PDF_PATTERN = /^\/api\/quote\/([A-Za-z0-9_-]{43})\/pdf$/;
export const PUBLIC_QUOTE_DECISION_PATTERN = /^\/api\/quote\/([A-Za-z0-9_-]{43})\/decision$/;
