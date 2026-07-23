import type { ApiError } from "../../api/types";

/**
 * Prefer the server's own message (close gates and validation rejections carry a
 * human-readable reason we want to show verbatim); fall back to a generic message
 * for transport-level errors that only carry a synthetic "HTTP ..." string.
 */
export function serverErrorMessage(error: ApiError, fallback: string): string {
  if (error.kind === "permission") return fallback;
  if ("message" in error && error.message && !/^HTTP\b/i.test(error.message)) {
    return error.message;
  }
  return fallback;
}
