import type { PostHog } from 'posthog-node';

const FEATURE_FLAG_DISABLE_VALUES = new Set(['true', '1', 'yes', 'on']);
const DEFAULT_POSTHOG_API_KEY = 'phc_RiwIhTqFG1NOWw6TS53fpnj3B7fAGv2Ixx7JD2S4IIn';
const DEFAULT_POSTHOG_HOST = 'https://us.i.posthog.com';

const DEFAULT_BOOLEAN_FLAGS: Record<string, boolean> = {
  'enable_ticket_automation': true,
  'enable_time_tracking': true,
  'enable_billing': true,
  'enable_reporting': true,
  'email-configuration': false,
  'ai-assistant-activation': false,
  'new_ticket_ui': false,
  'ai_ticket_suggestions': false,
  'advanced_workflow_engine': false,
  'beta_mobile_app': false,
  'new_dashboard_layout': false,
  'enable_voice_commands': false,
  'enable_ai_time_tracking': false,
  'enable_predictive_analytics': false,
  'enable_query_caching': true,
  'enable_lazy_loading': true,
  'enable_websocket_updates': false,
  'collaborative_editing': false,
  'enable_slack_integration': true,
  'enable_teams_integration': true,
  'enable_jira_sync': false,
  'enable_salesforce_sync': false,
  'enable_client_client_dual_write': true,
  'msp-i18n-enabled': false,
};

const DEFAULT_VARIANT_FLAGS: Record<string, string> = {
  dashboard_layout: 'classic',
  ticket_list_view: 'table',
  invoice_template: 'standard',
  email_composer: 'rich_text',
};

export function featureFlagsAreDisabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env.NEXT_PUBLIC_DISABLE_FEATURE_FLAGS ?? env.DISABLE_FEATURE_FLAGS;
  if (typeof raw !== 'string') {
    return false;
  }

  return FEATURE_FLAG_DISABLE_VALUES.has(raw.toLowerCase());
}

export interface FeatureFlagContext {
  userId?: string;
  tenantId?: string;
  userRole?: string;
  companySize?: 'small' | 'medium' | 'large' | 'enterprise';
  subscriptionPlan?: string;
  customProperties?: Record<string, unknown>;
}

export interface FeatureFlagVariant {
  key: string;
  name: string;
  rolloutPercentage?: number;
}

export interface FeatureFlagEvaluationEvent {
  flagKey: string;
  flagValue: boolean;
  context: FeatureFlagContext;
}

export interface FeatureFlagVariantAssignmentEvent {
  flagKey: string;
  variant: string;
  context: FeatureFlagContext;
}

export interface FeatureFlagsOptions {
  clientResolver?: () => Promise<PostHog | null | undefined> | PostHog | null | undefined;
  enrichProperties?: (
    context: FeatureFlagContext
  ) => Promise<Record<string, unknown> | null | undefined> | Record<string, unknown> | null | undefined;
  onBooleanEvaluation?: (
    event: FeatureFlagEvaluationEvent
  ) => Promise<void> | void;
  onVariantAssignment?: (
    event: FeatureFlagVariantAssignmentEvent
  ) => Promise<void> | void;
  cacheTtlMs?: number;
  posthogApiKey?: string;
  posthogHost?: string;
}

export class FeatureFlags {
  private client: PostHog | null = null;
  private clientInitialized = false;
  private readonly flagCache = new Map<string, { value: boolean | string; timestamp: number }>();
  private readonly manualOverrides = new Map<string, boolean | string>();
  private readonly cacheTtlMs: number;
  private readonly anonymizeUserIds: boolean;
  private readonly options: FeatureFlagsOptions;

  constructor(options: FeatureFlagsOptions = {}) {
    this.options = options;
    this.cacheTtlMs = options.cacheTtlMs ?? 60000;
    this.anonymizeUserIds = process.env.ANALYTICS_ANONYMIZE_USER_IDS !== 'false';
  }

  async isEnabled(flagKey: string, context: FeatureFlagContext = {}): Promise<boolean> {
    if (featureFlagsAreDisabled()) {
      return true;
    }

    const override = this.manualOverrides.get(flagKey);
    if (typeof override === 'boolean') {
      return override;
    }

    const cacheKey = this.getCacheKey(flagKey, context);
    const cached = this.getCachedValue(cacheKey);
    if (cached !== null && typeof cached === 'boolean') {
      return cached;
    }

    const client = await this.resolveClient();
    if (!client) {
      return this.getDefaultValue(flagKey);
    }

    try {
      const distinctId = await this.getDistinctId(context);
      const properties = await this.buildProperties(context);
      const personProperties = properties as Record<string, string>;
      const enabled = await client.isFeatureEnabled(flagKey, distinctId, {
        personProperties,
        groups: context.tenantId ? { tenant: context.tenantId } : undefined,
      });

      const flagValue = enabled || false;
      this.setCachedValue(cacheKey, flagValue);

      await this.options.onBooleanEvaluation?.({
        flagKey,
        flagValue,
        context,
      });

      return flagValue;
    } catch (error) {
      console.error(`Error evaluating feature flag ${flagKey}:`, error);
      return this.getDefaultValue(flagKey);
    }
  }

  async getVariant(flagKey: string, context: FeatureFlagContext = {}): Promise<string | null> {
    const override = this.manualOverrides.get(flagKey);
    if (typeof override === 'string') {
      return override;
    }

    const cacheKey = this.getCacheKey(flagKey, context);
    const cached = this.getCachedValue(cacheKey);
    if (cached !== null && typeof cached === 'string') {
      return cached;
    }

    if (featureFlagsAreDisabled()) {
      return this.getDefaultVariant(flagKey);
    }

    const client = await this.resolveClient();
    if (!client) {
      return this.getDefaultVariant(flagKey);
    }

    try {
      const distinctId = await this.getDistinctId(context);
      const properties = await this.buildProperties(context);
      const personProperties = properties as Record<string, string>;
      const variant = await client.getFeatureFlag(flagKey, distinctId, {
        personProperties,
        groups: context.tenantId ? { tenant: context.tenantId } : undefined,
      });

      const variantValue = typeof variant === 'string' ? variant : null;
      if (variantValue) {
        this.setCachedValue(cacheKey, variantValue);
        await this.options.onVariantAssignment?.({
          flagKey,
          variant: variantValue,
          context,
        });
      }

      return variantValue;
    } catch (error) {
      console.error(`Error getting feature flag variant ${flagKey}:`, error);
      return this.getDefaultVariant(flagKey);
    }
  }

  async getAllFlags(context: FeatureFlagContext = {}): Promise<Record<string, boolean | string>> {
    if (featureFlagsAreDisabled()) {
      return this.getAllDefaultValues();
    }

    const client = await this.resolveClient();
    if (!client) {
      return this.getAllDefaultValues();
    }

    try {
      const distinctId = await this.getDistinctId(context);
      const properties = await this.buildProperties(context);
      const personProperties = properties as Record<string, string>;
      const flags = await client.getAllFlags(distinctId, {
        personProperties,
        groups: context.tenantId ? { tenant: context.tenantId } : undefined,
      });

      return flags || {};
    } catch (error) {
      console.error('Error getting all feature flags:', error);
      return this.getAllDefaultValues();
    }
  }

  setOverride(flagKey: string, value: boolean | string): void {
    this.manualOverrides.set(flagKey, value);
  }

  clearOverride(flagKey: string): void {
    this.manualOverrides.delete(flagKey);
  }

  clearCache(): void {
    this.flagCache.clear();
  }

  private async resolveClient(): Promise<PostHog | null> {
    const providedClient = await this.options.clientResolver?.();
    if (providedClient !== undefined) {
      return providedClient;
    }

    if (this.clientInitialized) {
      return this.client;
    }

    this.clientInitialized = true;
    if (process.env.ALGA_USAGE_STATS === 'false' || process.env.NEXT_PUBLIC_ALGA_USAGE_STATS === 'false') {
      this.client = null;
      return this.client;
    }

    const { PostHog } = await import('posthog-node');
    this.client = new PostHog(this.options.posthogApiKey ?? DEFAULT_POSTHOG_API_KEY, {
      host: this.options.posthogHost ?? DEFAULT_POSTHOG_HOST,
      flushAt: 20,
      flushInterval: 30000,
    });
    return this.client;
  }

  private getCacheKey(flagKey: string, context: FeatureFlagContext): string {
    return JSON.stringify({
      flagKey,
      userId: context.userId ?? null,
      tenantId: context.tenantId ?? null,
      userRole: context.userRole ?? null,
      companySize: context.companySize ?? null,
      subscriptionPlan: context.subscriptionPlan ?? null,
      customProperties: this.normalizeForCache(context.customProperties),
    });
  }

  private normalizeForCache(value: unknown): unknown {
    if (Array.isArray(value)) {
      return value.map((item) => this.normalizeForCache(item));
    }

    if (value && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([key, nested]) => [key, this.normalizeForCache(nested)])
      );
    }

    return value ?? null;
  }

  private async getDistinctId(context: FeatureFlagContext): Promise<string> {
    if (context.userId) {
      return !this.anonymizeUserIds
        ? `user_${context.userId}`
        : `user_${await this.hashUserId(context.userId)}`;
    }

    if (context.tenantId) {
      return `tenant_${context.tenantId}`;
    }

    return 'anonymous';
  }

  private async buildProperties(context: FeatureFlagContext): Promise<Record<string, unknown>> {
    const properties: Record<string, unknown> = {
      environment: process.env.NODE_ENV || 'development',
      ...context.customProperties,
    };

    if (context.userRole) {
      properties.user_role = context.userRole;
    }

    if (context.companySize) {
      properties.company_size = context.companySize;
    }

    if (context.subscriptionPlan) {
      properties.subscription_plan = context.subscriptionPlan;
    }

    if (context.tenantId) {
      properties.tenant = context.tenantId;
    }

    const extraProperties = await this.options.enrichProperties?.(context);
    if (extraProperties) {
      Object.assign(properties, extraProperties);
    }

    return properties;
  }

  private getCachedValue(cacheKey: string): boolean | string | null {
    const cached = this.flagCache.get(cacheKey);
    if (!cached) {
      return null;
    }

    if (Date.now() - cached.timestamp > this.cacheTtlMs) {
      this.flagCache.delete(cacheKey);
      return null;
    }

    return cached.value;
  }

  private setCachedValue(cacheKey: string, value: boolean | string): void {
    this.flagCache.set(cacheKey, {
      value,
      timestamp: Date.now(),
    });
  }

  private async hashUserId(userId: string): Promise<string> {
    const { createHash } = await import('node:crypto');
    return createHash('sha256').update(userId).digest('hex').substring(0, 16);
  }

  private getDefaultValue(flagKey: string): boolean {
    return DEFAULT_BOOLEAN_FLAGS[flagKey] ?? false;
  }

  private getDefaultVariant(flagKey: string): string | null {
    return DEFAULT_VARIANT_FLAGS[flagKey] ?? null;
  }

  private getAllDefaultValues(): Record<string, boolean | string> {
    return {
      ...DEFAULT_BOOLEAN_FLAGS,
      ...DEFAULT_VARIANT_FLAGS,
    };
  }
}

export const featureFlags = new FeatureFlags();
