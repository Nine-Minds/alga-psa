/**
 * Contact API Schemas
 * Validation schemas for contact-related API endpoints
 */

import { z } from 'zod';
import { 
  uuidSchema, 
  emailSchema, 
  phoneSchema, 
  createListQuerySchema, 
  createUpdateSchema,
  baseFilterSchema,
  booleanTransform
} from './common';

// Create contact schema
export const createContactSchema = z.object({
  full_name: z.string().min(1, 'Full name is required').max(255),
  client_id: uuidSchema.optional(),
  phone_number: phoneSchema,
  email: emailSchema,
  role: z.string().max(100).optional(),
  notes: z.string().optional(),
  is_inactive: z.boolean().optional().default(false),
  tags: z.array(z.string()).optional()
});

// Update contact schema (all fields optional)
export const updateContactSchema = createUpdateSchema(createContactSchema);

// Contact filter schema
export const contactFilterSchema = baseFilterSchema.extend({
  full_name: z.string().optional(),
  email: z.string().optional(),
  phone_number: z.string().optional(),
  client_id: uuidSchema.optional(),
  role: z.string().optional(),
  is_inactive: booleanTransform.optional(),
  has_client: booleanTransform.optional(),
  client_name: z.string().optional()
});

// Contact list query schema
export const contactListQuerySchema = createListQuerySchema(contactFilterSchema);

// Contact response schema
export const contactResponseSchema = z.object({
  contact_name_id: uuidSchema,
  full_name: z.string(),
  client_id: uuidSchema.nullable(),
  phone_number: z.string().nullable(),
  email: z.string(),
  role: z.string().nullable(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
  is_inactive: z.boolean(),
  notes: z.string().nullable(),
  avatarUrl: z.string().nullable().optional(),
  tenant: uuidSchema,
  tags: z.array(z.string()).optional(),
  // Joined fields
  client_name: z.string().nullable().optional()
});

// Contact with client details
export const contactWithClientResponseSchema = contactResponseSchema.extend({
  client: z.object({
    client_id: uuidSchema,
    client_name: z.string(),
    email: z.string().nullable(),
    phone_no: z.string().nullable(),
    is_inactive: z.boolean()
  }).nullable().optional()
});

// Bulk operations schemas
export const bulkUpdateContactSchema = z.object({
  contacts: z.array(z.object({
    contact_name_id: uuidSchema,
    data: updateContactSchema
  })).min(1).max(100)
});

export const bulkDeleteContactSchema = z.object({
  contact_ids: z.array(uuidSchema).min(1).max(100)
});

// Contact import/export schemas
export const contactImportSchema = z.object({
  contacts: z.array(createContactSchema).min(1).max(1000),
  options: z.object({
    update_existing: z.boolean().optional().default(false),
    skip_invalid: z.boolean().optional().default(true),
    dry_run: z.boolean().optional().default(false)
  }).optional()
});

export const contactExportQuerySchema = z.object({
  format: z.enum(['csv', 'json']).optional().default('csv'),
  include_inactive: booleanTransform.optional().default("false"),
  client_id: uuidSchema.optional(),
  fields: z.array(z.string()).optional()
});

// Contact statistics schema
export const contactStatsResponseSchema = z.object({
  total_contacts: z.number(),
  active_contacts: z.number(),
  inactive_contacts: z.number(),
  contacts_with_client: z.number(),
  contacts_without_client: z.number(),
  contacts_by_role: z.record(z.number()),
  recent_contacts: z.number() // contacts created in last 30 days
});

// Search schema for advanced contact search
export const contactSearchSchema = z.object({
  query: z.string().min(1, 'Search query is required'),
  fields: z.union([
    z.array(z.enum(['full_name', 'email', 'phone_number', 'role', 'notes'])),
    z.string().transform(val => val.split(',').map(f => f.trim()))
  ]).optional(),
  client_id: uuidSchema.optional(),
  include_inactive: booleanTransform.optional().default("false"),
  limit: z.string().transform(val => parseInt(val)).pipe(z.number().min(1).max(100)).optional().default('25')
});

// Export types for TypeScript
export type CreateContactData = z.infer<typeof createContactSchema>;
export type UpdateContactData = z.infer<typeof updateContactSchema>;
export type ContactFilterData = z.infer<typeof contactFilterSchema>;
export type ContactResponse = z.infer<typeof contactResponseSchema>;
export type ContactWithClientResponse = z.infer<typeof contactWithClientResponseSchema>;
export type ContactSearchData = z.infer<typeof contactSearchSchema>;
export type ContactImportData = z.infer<typeof contactImportSchema>;
export type ContactExportQuery = z.infer<typeof contactExportQuerySchema>;