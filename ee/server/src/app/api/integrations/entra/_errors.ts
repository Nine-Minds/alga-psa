import { isEntraOperatorError } from '@ee/lib/integrations/entra/entraOperatorError';

/**
 * What of a failure is safe, and useful, to put in front of an operator.
 *
 * Anything thrown as an EntraOperatorError was written for a person and passes
 * through. The string list below is the legacy form of the same idea, kept
 * because those messages are raised from places that do not import the class.
 * Everything else collapses to the caller's fallback, so driver internals and
 * stack detail stay off the screen.
 */
const OPERATOR_READABLE_MESSAGES = new Set([
  'No active Entra connection exists for this tenant.',
  'Microsoft credentials are not configured for direct Entra token refresh.',
  'No direct Entra refresh token is stored for this tenant.',
  'Direct Entra token refresh response was missing required fields.',
]);

export function entraRouteErrorMessage(error: unknown, fallback: string): string {
  if (isEntraOperatorError(error) && error.message) {
    return error.message;
  }

  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';

  return OPERATOR_READABLE_MESSAGES.has(message) ? message : fallback;
}
