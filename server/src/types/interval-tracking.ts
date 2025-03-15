/**
 * Type definitions for the interval tracking system
 */

/**
 * Represents a single ticket viewing interval
 */
export interface TicketInterval {
  id: string;                 // Unique identifier for the interval
  ticketId: string;           // ID of the ticket being viewed
  ticketNumber: string;       // Ticket number for display purposes
  ticketTitle: string;        // Title of the ticket for display
  startTime: string;          // ISO timestamp when viewing started
  endTime: string | null;     // ISO timestamp when viewing ended (null if still open)
  duration: number | null;    // Duration in seconds (null if still open)
  autoClosed: boolean;        // Flag indicating if interval was auto-closed
  userId: string;             // User who viewed the ticket
  selected?: boolean;         // UI state for selection in the intervals list
}

/**
 * IndexedDB database schema for interval tracking
 */
export interface IntervalDBSchema {
  name: string;
  version: number;
  stores: {
    name: string;
    keyPath: string;
    indexes: {
      name: string;
      keyPath: string;
      options?: IDBIndexParameters;
    }[];
  }[];
}

/**
 * Represents a group of intervals for a specific ticket
 */
export interface TicketIntervalGroup {
  ticketId: string;
  ticketNumber: string;
  ticketTitle: string;
  intervals: TicketInterval[];
}