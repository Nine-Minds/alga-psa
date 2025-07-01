// Telemetry configuration with privacy-first defaults
export const TELEMETRY_CONFIG = {
  CATEGORIES: {
    ERROR_TRACKING: 'error_tracking',
    PERFORMANCE_METRICS: 'performance_metrics', 
    USAGE_ANALYTICS: 'usage_analytics',
    SYSTEM_METRICS: 'system_metrics'
  },
  
  // Default to all enabled - users can opt-out if desired
  DEFAULT_PREFERENCES: {
    error_tracking: true,
    performance_metrics: true,
    usage_analytics: true,
    system_metrics: true
  },
  
  // Privacy settings
  PRIVACY: {
    SANITIZE_PII: true,
    ANONYMIZE_IPS: true,
    CONSENT_VERSION: '1.0'
  },
  
  // Sensitive endpoints to exclude from telemetry
  EXCLUDED_PATHS: [
    '/api/auth',
    '/api/user/preferences',
    '/health',
    '/api/telemetry'
  ]
} as const;

export type TelemetryCategory = keyof typeof TELEMETRY_CONFIG.CATEGORIES;
export type AnonymizationLevel = 'none' | 'partial' | 'full';

export interface TenantTelemetrySettings {
  enabled: boolean;
  allowUserOverride: boolean;
  anonymizationLevel: AnonymizationLevel;
  excludePatterns?: string[];
  lastUpdated: string;
  updatedBy: string;
  complianceNotes?: string;
}

export interface UserTelemetryPreferences {
  optedOut: boolean;
  excludeFeatures?: string[];
  lastUpdated: string;
  consentVersion: string;
}

export type TelemetryPreferences = Record<string, boolean> & {
  last_updated?: string;
  consent_version?: string;
};

export const TENANT_TELEMETRY_DEFAULTS: TenantTelemetrySettings = {
  enabled: true, // Enabled by default for product improvement
  allowUserOverride: true,
  anonymizationLevel: 'partial',
  excludePatterns: [],
  lastUpdated: new Date().toISOString(),
  updatedBy: 'system',
  complianceNotes: undefined
};

export const USER_TELEMETRY_DEFAULTS: UserTelemetryPreferences = {
  optedOut: false, // When tenant allows, users are opted-in by default but can opt-out
  excludeFeatures: [],
  lastUpdated: new Date().toISOString(),
  consentVersion: '1.0'
};

// Industry-specific defaults
export const INDUSTRY_DEFAULTS: Record<string, Partial<TenantTelemetrySettings>> = {
  healthcare: {
    enabled: false, // HIPAA compliance - still requires opt-in
    allowUserOverride: false,
    anonymizationLevel: 'full',
    complianceNotes: 'HIPAA compliance requires explicit opt-in due to medical data sensitivity'
  },
  financial: {
    enabled: false, // Financial regulations - still requires opt-in
    allowUserOverride: false, 
    anonymizationLevel: 'full',
    complianceNotes: 'Financial data regulations require explicit opt-in due to regulatory requirements'
  },
  legal: {
    enabled: false, // Attorney-client privilege - still requires opt-in
    allowUserOverride: false,
    anonymizationLevel: 'full',
    complianceNotes: 'Legal privilege requirements prohibit data sharing without explicit consent'
  },
  general: {
    enabled: true, // General businesses: enabled by default with opt-out
    allowUserOverride: true,
    anonymizationLevel: 'partial',
    complianceNotes: 'Standard telemetry enabled to improve product quality. Users can opt-out anytime.'
  }
};