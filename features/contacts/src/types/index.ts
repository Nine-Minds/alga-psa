import { z } from 'zod';

/**
 * Contact entity representing a person associated with a client/company
 */
export interface Contact {
  contact_name_id: string;
  tenant: string;
  full_name: string;
  email: string | null;
  phone_number: string | null;
  company_id: string | null;
  is_inactive: boolean;
  created_at: Date;
  updated_at: Date;
  role: string | null;
  notes: string | null;
  date_of_birth: Date | null;
  tags?: string[];
}

/**
 * Input schema for creating a new contact
 */
export const createContactSchema = z.object({
  full_name: z.string().min(1, 'Name is required').max(255),
  email: z.string().email().nullable().optional(),
  phone_number: z.string().max(50).nullable().optional(),
  company_id: z.string().uuid().nullable().optional(),
  role: z.string().max(100).nullable().optional(),
  notes: z.string().nullable().optional(),
  date_of_birth: z.coerce.date().nullable().optional(),
  tags: z.array(z.string().uuid()).optional(),
});

export type CreateContactInput = z.infer<typeof createContactSchema>;

/**
 * Input schema for updating an existing contact
 */
export const updateContactSchema = createContactSchema.partial().extend({
  contact_name_id: z.string().uuid(),
});

export type UpdateContactInput = z.infer<typeof updateContactSchema>;

/**
 * Filters for querying contacts
 */
export interface ContactFilters {
  search?: string;
  company_id?: string;
  is_inactive?: boolean;
  tags?: string[];
  limit?: number;
  offset?: number;
  orderBy?: keyof Contact;
  orderDirection?: 'asc' | 'desc';
}

/**
 * Paginated response for contact queries
 */
export interface ContactListResponse {
  contacts: Contact[];
  total: number;
  limit: number;
  offset: number;
}
