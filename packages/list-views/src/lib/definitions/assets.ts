import { z } from 'zod';

/** What a named Assets view stores. Search text is not view state. */
export interface AssetListViewFilters {
  statuses?: string[];
  types?: string[];
  clientIds?: string[];
  agentStatuses?: string[];
  rmmManaged?: string[];
}

const shape: { [K in keyof Required<AssetListViewFilters>]: z.ZodTypeAny } = {
  statuses: z.array(z.string()),
  types: z.array(z.string()),
  clientIds: z.array(z.string()),
  agentStatuses: z.array(z.string()),
  rmmManaged: z.array(z.string()),
};

export const assetListViewFiltersSchema = z.object(shape).partial().strict();
