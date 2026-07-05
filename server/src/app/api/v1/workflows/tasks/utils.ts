/**
 * Shared helpers for the v1 Workflow Task API (EE-only inbox + claim/complete).
 *
 * Identity bridge: reuses Wave 1's `resolveActivityAuthContext` verbatim — it resolves the
 * caller from the NextAuth session first, then falls back to API-key auth, with no
 * activities-specific logic. Routes then call the EE/CE workflow-task seam under
 * `runWithTenant`. The seam's `taskInbox` cores enforce their own permission/claim rules.
 */

import {
  resolveActivityAuthContext,
  type ActivityAuthContext,
} from '@/app/api/v1/activities/utils';
import {
  NotFoundError,
  UnauthorizedError,
  ConflictError,
  ValidationError,
} from '@/lib/api/middleware/apiMiddleware';

export type WorkflowTaskAuthContext = ActivityAuthContext;

/** Re-exported under a neutral name; see `resolveActivityAuthContext` for the shared bridge. */
export const resolveWorkflowTaskAuthContext = resolveActivityAuthContext;

/**
 * The workflow-task cores throw plain `Error`s for business-rule failures. Re-classify the
 * known messages into typed API errors so `handleApiError` maps them to the right HTTP
 * status (400 validation, 401 unauthenticated, 404 not found, 409 claim conflict). The
 * server-side schema validation failure (`Form validation failed: …`) is surfaced as a 400
 * with the parsed JSON-Schema errors as `details`. Anything already typed (with a
 * `statusCode`) or otherwise unknown is returned untouched.
 */
export function classifyWorkflowTaskError(error: unknown): unknown {
  if (error instanceof Error && typeof (error as { statusCode?: unknown }).statusCode !== 'number') {
    const message = error.message || '';

    if (/^Form validation failed:/i.test(message)) {
      let details: unknown;
      try {
        details = JSON.parse(message.replace(/^Form validation failed:\s*/i, ''));
      } catch {
        // Leave details undefined if the message isn't the expected JSON payload.
      }
      return new ValidationError('Form validation failed', details);
    }
    if (/not found/i.test(message)) {
      return new NotFoundError(message);
    }
    if (/not authenticated/i.test(message)) {
      return new UnauthorizedError(message);
    }
    if (/already claimed|claimed by another|cannot be claimed|not in claimed state/i.test(message)) {
      return new ConflictError(message);
    }
    if (/required|invalid|missing/i.test(message)) {
      return new ValidationError(message);
    }
  }
  return error;
}
