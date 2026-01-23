/**
 * Permission-related error utilities
 */

export function isPermissionError(error: unknown): boolean {
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
