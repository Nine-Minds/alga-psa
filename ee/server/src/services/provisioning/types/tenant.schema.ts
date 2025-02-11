import { z } from 'zod';

export const CreateTenantSchema = z.object({
  company_name: z.string().min(1, 'Company name is required'),
  email: z.string().email('Valid email is required'),
  phone_number: z.string().optional(),
  industry: z.string().optional(),
  plan: z.string().optional(),
  tax_id_number: z.string().optional()
});

export type CreateTenantInput = z.infer<typeof CreateTenantSchema>;

export const TenantResponseSchema = z.object({
  tenant: z.string().uuid(),
  company_name: z.string(),
  email: z.string(),
  phone_number: z.string().nullable(),
  industry: z.string().nullable(),
  plan: z.string().nullable(),
  tax_id_number: z.string().nullable(),
  created_at: z.date(),
  updated_at: z.date()
});

export type TenantResponse = z.infer<typeof TenantResponseSchema>;

export const ErrorResponseSchema = z.object({
  error: z.string(),
  details: z.any().optional()
});

export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;
