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
export function isConcurrencyConflict(error: unknown): error is ConcurrencyConflictError {
  return (
    error instanceof Error &&
    'code' in error &&
    (error as ConcurrencyConflictError).code === CONCURRENCY_CONFLICT_CODE
  );
}

// Return type for updateTicketWithCache
export interface UpdateTicketResult {
  success: boolean;
  updated_at: string;
}
