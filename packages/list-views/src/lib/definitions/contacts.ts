import { z } from 'zod';

/** What a named Contacts view stores. Search text is not view state. */
export interface ContactListViewFilters {
  status?: 'all' | 'active' | 'inactive';
  /** Tag texts. */
  tags?: string[];
}

const shape: { [K in keyof Required<ContactListViewFilters>]: z.ZodTypeAny } = {
  status: z.enum(['all', 'active', 'inactive']),
  tags: z.array(z.string()),
};

export const contactListViewFiltersSchema = z.object(shape).partial().strict();
