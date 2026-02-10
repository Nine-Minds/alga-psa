import { getSecret } from '@/lib/utils/getSecret';
import {
  PostHogFeatureFlag,
  PostHogFlagListResponse,
  PostHogFlagFilters,
  CreateFeatureFlagInput,
  UpdateFeatureFlagInput,
} from './types';

const POSTHOG_API_HOST = process.env.POSTHOG_API_HOST || 'https://us.posthog.com';

async function getPostHogConfig(): Promise<{ apiKey: string; projectId: string }> {
  const apiKey = await getSecret('posthog_personal_api_key', 'POSTHOG_PERSONAL_API_KEY');
  const projectId = await getSecret('posthog_project_id', 'POSTHOG_PROJECT_ID');

  if (!apiKey) {
    throw new Error('PostHog personal API key not configured');
  }
  if (!projectId) {
    throw new Error('PostHog project ID not configured');
  }

  return { apiKey, projectId };
}

async function posthogFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const { apiKey, projectId } = await getPostHogConfig();
  const url = `${POSTHOG_API_HOST}/api/projects/${projectId}${path}`;

  const response = await fetch(url, {
    ...options,
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`PostHog API error (${response.status}): ${errorText}`);
  }

  if (response.status === 204) {
    return undefined as unknown as T;
  }

  return response.json();
}

export class PostHogFeatureFlagService {
  async listFlags(): Promise<PostHogFeatureFlag[]> {
    const data = await posthogFetch<PostHogFlagListResponse>('/feature_flags/?limit=200');
    return data.results;
  }

  async getFlag(id: number): Promise<PostHogFeatureFlag> {
    return posthogFetch<PostHogFeatureFlag>(`/feature_flags/${id}/`);
  }

  async createFlag(input: CreateFeatureFlagInput): Promise<PostHogFeatureFlag> {
    const body: Record<string, unknown> = {
      key: input.key,
      name: input.name || input.key,
      active: input.active ?? true,
      filters: input.filters || {
        groups: [{ properties: [], rollout_percentage: 0 }],
        multivariate: null,
        aggregation_group_type_index: null,
        payloads: {},
      },
      ensure_experience_continuity: input.ensure_experience_continuity ?? false,
    };

    if (input.tags) {
      body.tags = input.tags;
    }

    return posthogFetch<PostHogFeatureFlag>('/feature_flags/', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  async updateFlag(id: number, updates: UpdateFeatureFlagInput): Promise<PostHogFeatureFlag> {
    // GET first, merge, then PATCH (PostHog PATCH overwrites entire config)
    const existing = await this.getFlag(id);

    const merged: Record<string, unknown> = {
      key: updates.key ?? existing.key,
      name: updates.name ?? existing.name,
      active: updates.active ?? existing.active,
      filters: updates.filters ?? existing.filters,
      ensure_experience_continuity: updates.ensure_experience_continuity ?? existing.ensure_experience_continuity,
    };

    if (updates.tags !== undefined) {
      merged.tags = updates.tags;
    }

    return posthogFetch<PostHogFeatureFlag>(`/feature_flags/${id}/`, {
      method: 'PATCH',
      body: JSON.stringify(merged),
    });
  }

  async deleteFlag(id: number): Promise<void> {
    await posthogFetch<void>(`/feature_flags/${id}/`, {
      method: 'DELETE',
    });
  }

  /**
   * Add a tenant ID to a flag's release conditions.
   * Finds or creates a group that filters on the `tenant_id` property
   * and adds the tenant to its value array.
   */
  async addTenantToFlag(flagId: number, tenantId: string): Promise<PostHogFeatureFlag> {
    const flag = await this.getFlag(flagId);
    const filters: PostHogFlagFilters = JSON.parse(JSON.stringify(flag.filters));

    // Find existing tenant group
    let tenantGroup = filters.groups.find(g =>
      g.properties.some(p => p.key === 'tenant_id' && p.operator === 'exact')
    );

    if (tenantGroup) {
      const prop = tenantGroup.properties.find(p => p.key === 'tenant_id' && p.operator === 'exact');
      if (prop && !prop.value.includes(tenantId)) {
        prop.value = [...prop.value, tenantId];
      }
    } else {
      // Create a new group for tenant targeting
      filters.groups.push({
        properties: [{
          key: 'tenant_id',
          value: [tenantId],
          operator: 'exact',
          type: 'person',
        }],
        rollout_percentage: 100,
        variant: null,
      });
    }

    return this.updateFlag(flagId, { filters });
  }

  /**
   * Remove a tenant ID from a flag's release conditions.
   */
  async removeTenantFromFlag(flagId: number, tenantId: string): Promise<PostHogFeatureFlag> {
    const flag = await this.getFlag(flagId);
    const filters: PostHogFlagFilters = JSON.parse(JSON.stringify(flag.filters));

    for (const group of filters.groups) {
      for (const prop of group.properties) {
        if (prop.key === 'tenant_id' && prop.operator === 'exact') {
          prop.value = prop.value.filter((v: string) => v !== tenantId);
        }
      }
    }

    // Remove empty tenant groups (groups where tenant_id property has no values)
    filters.groups = filters.groups.filter(g => {
      const tenantProp = g.properties.find(p => p.key === 'tenant_id' && p.operator === 'exact');
      // Keep group if it has no tenant_id property OR if tenant_id still has values
      return !tenantProp || tenantProp.value.length > 0;
    });

    // Ensure at least one group exists
    if (filters.groups.length === 0) {
      filters.groups = [{ properties: [], rollout_percentage: 0, variant: null }];
    }

    return this.updateFlag(flagId, { filters });
  }
}
