/**
 * Permission-related error utilities
 */

/**
 * Whether a *thrown* error denotes a permission failure.
 *
 * Mirrors `isAuthorizationThrow` in `@alga-psa/ui/lib/errorHandling`: the explicit
 * code is the real channel, and the English prefix is only a fallback for throw
 * sites not yet converted. Safe here because a thrown message never crosses the
 * localization boundary — only returned payloads do, and those are classified by
 * shape. Reimplemented rather than imported to keep this leaf module free of the
 * React/toast dependencies that module pulls in.
 */
export function isPermissionError(error: unknown): boolean {
  if (typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'PERMISSION_DENIED') {
    return true;
  }
  return error instanceof Error && error.message.includes('Permission denied');
}

export function formatPermissionError(action: string, resource?: string): string {
  if (resource) {
    return `Permission denied: You don't have permission to ${action} ${resource}`;
  }
  return `Permission denied: You don't have permission to ${action}`;
}

export function throwPermissionError(action: string, additionalInfo?: string): never {
  const baseMessage = formatPermissionError(action);
  const fullMessage = additionalInfo ? `${baseMessage}. ${additionalInfo}` : baseMessage;
  throw new Error(fullMessage);
}
