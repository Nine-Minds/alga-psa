// Types and classes for ticket actions
// Separated from optimizedTicketActions.ts because 'use server' files can only export async functions

// Error code constant - ensures client and server stay in sync
export const CONCURRENCY_CONFLICT_CODE = 'CONCURRENCY_CONFLICT' as const;

// Custom error class for concurrency conflicts - allows typed error handling on the client
export class ConcurrencyConflictError extends Error {
  readonly code: typeof CONCURRENCY_CONFLICT_CODE = CONCURRENCY_CONFLICT_CODE;
  readonly currentUpdatedAt: string;

  constructor(message: string, currentUpdatedAt: string) {
    super(message);
    this.name = 'ConcurrencyConflictError';
    this.currentUpdatedAt = currentUpdatedAt;
  }
}

// Type guard for concurrency conflict errors - exported so client and server use the same logic
// Note: When errors cross the server/client boundary in Next.js server actions, they lose
// their prototype chain during serialization. We check multiple conditions to be robust.
export function isConcurrencyConflict(error: unknown): error is ConcurrencyConflictError {
  if (!error || typeof error !== 'object') {
    return false;
  }

  // Check for the code property (works for both serialized and non-serialized errors)
  if ('code' in error && (error as { code: unknown }).code === CONCURRENCY_CONFLICT_CODE) {
    return true;
  }

  // Fallback: check error message for concurrency conflict pattern
  // This handles cases where only the message survives serialization
  if ('message' in error && typeof (error as { message: unknown }).message === 'string') {
    const message = (error as { message: string }).message.toLowerCase();
    if (message.includes('modified by another user') || message.includes('concurrency')) {
      return true;
    }
  }

  return false;
}

// Return type for updateTicketWithCache
export interface UpdateTicketResult {
  success: boolean;
  updated_at: string;
}
