// Types and classes for ticket actions
// Separated from optimizedTicketActions.ts because 'use server' files can only export async functions

// Custom error class for concurrency conflicts - allows typed error handling on the client
export class ConcurrencyConflictError extends Error {
  readonly code = 'CONCURRENCY_CONFLICT' as const;
  readonly currentUpdatedAt: string;

  constructor(message: string, currentUpdatedAt: string) {
    super(message);
    this.name = 'ConcurrencyConflictError';
    this.currentUpdatedAt = currentUpdatedAt;
  }
}

// Return type for updateTicketWithCache
export interface UpdateTicketResult {
  success: boolean;
  updated_at: string;
}
