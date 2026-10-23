import { z } from 'zod';

/** What a named Projects view stores. Search text and pagination are not view state. */
export interface ProjectListViewFilters {
  status?: 'all' | 'active' | 'inactive';
  /** 'all' | 'open' | 'closed' or a specific status id. */
  projectStatus?: string;
  clientId?: string;
  contactId?: string;
  managerId?: string;
  tags?: string[];
  deadlineType?: 'before' | 'after' | 'on' | 'between';
  deadlineDate?: string;
  deadlineEndDate?: string;
}

const shape: { [K in keyof Required<ProjectListViewFilters>]: z.ZodTypeAny } = {
  status: z.enum(['all', 'active', 'inactive']),
  projectStatus: z.string().min(1),
  clientId: z.string().min(1),
  contactId: z.string().min(1),
  managerId: z.string().min(1),
  tags: z.array(z.string()),
  deadlineType: z.enum(['before', 'after', 'on', 'between']),
  deadlineDate: z.string(),
  deadlineEndDate: z.string(),
};

export const projectListViewFiltersSchema = z.object(shape).partial().strict();
