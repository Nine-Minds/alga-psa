/**
 * Entity number-format defaults.
 *
 * Pure data with no server-only imports so client settings components can read
 * it without pulling the DB stack into the browser bundle. The server-side
 * numberingService re-exports these for its callers.
 */

// Define supported entity types
export type EntityType = 'TICKET' | 'INVOICE' | 'PROJECT' | 'QUOTE' | 'CREDIT_NOTE' | 'SALES_ORDER' | 'OPPORTUNITY';

// Tenant-facing defaults for each entity type's number format. Self-init
// inserts these with onConflict-ignore, so a tenant's own settings (edited
// via the numbering settings UI) always win over this map.
export const NUMBERING_DEFAULTS: Record<
  EntityType,
  { prefix: string; padding_length: number | null; initial_value: number }
> = {
  TICKET: { prefix: 'TIC', padding_length: null, initial_value: 1000 },
  INVOICE: { prefix: 'INV-', padding_length: 6, initial_value: 1 },
  PROJECT: { prefix: 'PROJECT', padding_length: 4, initial_value: 1 },
  QUOTE: { prefix: 'QUO-', padding_length: 4, initial_value: 1 },
  CREDIT_NOTE: { prefix: 'CM-', padding_length: 6, initial_value: 1 },
  SALES_ORDER: { prefix: 'SO', padding_length: 5, initial_value: 1 },
  OPPORTUNITY: { prefix: 'OPP-', padding_length: 4, initial_value: 1 },
};
