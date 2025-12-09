/**
 * Canonical Client Interfaces
 * These are the canonical definitions for client-related types used across the codebase.
 * All references should use these definitions unless there's a specific reason not to.
 */

/**
 * Core client entity interface
 */
export interface IClient {
  client_id: string;
  client_name: string;
  client_type?: 'company' | 'individual' | null;
  tenant?: string;
  url?: string | null;
  phone_no?: string | null;
  email?: string | null;
  address?: string | null;
  address_2?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  country?: string | null;
  default_currency_code?: string | null;
  notes?: string | null;
  is_inactive?: boolean | null;
  created_at: string;
  updated_at: string;
  properties?: Record<string, any> | null;
  parent_client_id?: string | null;
  contract_line_id?: string | null;
  is_default?: boolean | null;
  [key: string]: any; // Allow additional properties for database fields
}

/**
 * Input type for creating a new client
 */
export interface CreateClientInput {
  client_name: string;
  client_type?: 'company' | 'individual';
  url?: string;
  phone_no?: string;
  email?: string;
  address?: string;
  address_2?: string;
  city?: string;
  state?: string;
  zip?: string;
  country?: string;
  default_currency_code?: string;
  notes?: string;
  properties?: Record<string, any>;
  parent_client_id?: string;
  contract_line_id?: string;
  is_default?: boolean;
}

/**
 * Input type for updating an existing client
 */
export interface UpdateClientInput {
  client_name?: string;
  client_type?: 'company' | 'individual';
  url?: string;
  phone_no?: string;
  email?: string;
  address?: string;
  address_2?: string;
  city?: string;
  state?: string;
  zip?: string;
  country?: string;
  default_currency_code?: string;
  notes?: string;
  is_inactive?: boolean;
  properties?: Record<string, any>;
  parent_client_id?: string;
  contract_line_id?: string;
}

/**
 * Options for client creation process
 */
export interface ClientCreationOptions {
  skipTaxSettings?: boolean;
  skipEmailSuffix?: boolean;
}