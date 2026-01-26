// Types for ticket actions
// Separated from optimizedTicketActions.ts because 'use server' files can only export async functions

// Return type for updateTicketWithCache
export interface UpdateTicketResult {
  success: boolean;
  updated_at: string;
}
