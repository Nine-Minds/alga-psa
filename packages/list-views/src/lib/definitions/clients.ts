import { z } from 'zod';

/** What a named Clients view stores. Search text is not view state. */
export interface ClientListViewFilters {
  status?: 'all' | 'active' | 'inactive';
  clientType?: 'all' | 'company' | 'individual';
  lifecycle?: 'all' | 'prospect' | 'active' | 'former';
  /** Tag texts. */
  tags?: string[];
}

const shape: { [K in keyof Required<ClientListViewFilters>]: z.ZodTypeAny } = {
  status: z.enum(['all', 'active', 'inactive']),
  clientType: z.enum(['all', 'company', 'individual']),
  lifecycle: z.enum(['all', 'prospect', 'active', 'former']),
  tags: z.array(z.string()),
};

export const clientListViewFiltersSchema = z.object(shape).partial().strict();
