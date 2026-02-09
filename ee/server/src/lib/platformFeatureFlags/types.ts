export interface PostHogFlagProperty {
  key: string;
  value: string[];
  operator: string;
  type: string;
}

export interface PostHogFlagGroup {
  properties: PostHogFlagProperty[];
  rollout_percentage: number | null;
  variant: string | null;
}

export interface PostHogFlagFilters {
  groups: PostHogFlagGroup[];
  multivariate: {
    variants: PostHogVariant[];
  } | null;
  aggregation_group_type_index: number | null;
  payloads: Record<string, unknown>;
}

export interface PostHogVariant {
  key: string;
  name: string;
  rollout_percentage: number;
}

export interface PostHogFeatureFlag {
  id: number;
  key: string;
  name: string;
  filters: PostHogFlagFilters;
  deleted: boolean;
  active: boolean;
  created_by: {
    id: number;
    email: string;
    first_name: string;
  } | null;
  created_at: string;
  is_simple_flag: boolean;
  rollout_percentage: number | null;
  ensure_experience_continuity: boolean;
  experiment_set: unknown[] | null;
  surveys: unknown[] | null;
  tags: string[];
}

export interface PostHogFlagListResponse {
  count: number;
  next: string | null;
  previous: string | null;
  results: PostHogFeatureFlag[];
}

export interface CreateFeatureFlagInput {
  key: string;
  name?: string;
  filters?: Partial<PostHogFlagFilters>;
  active?: boolean;
  ensure_experience_continuity?: boolean;
  tags?: string[];
}

export interface UpdateFeatureFlagInput {
  key?: string;
  name?: string;
  filters?: PostHogFlagFilters;
  active?: boolean;
  ensure_experience_continuity?: boolean;
  tags?: string[];
}
