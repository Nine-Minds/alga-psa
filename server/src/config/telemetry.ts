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
  
  ENVIRONMENT_OVERRIDES: {
    TELEMETRY_ENABLED: process.env.TELEMETRY_ENABLED !== 'false', // Enabled by default, must explicitly disable
    TELEMETRY_FORCE_DISABLE: process.env.TELEMETRY_FORCE_DISABLE === 'true',
    TELEMETRY_ENDPOINT: process.env.TELEMETRY_ENDPOINT || process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
    TELEMETRY_SAMPLE_RATE: parseFloat(process.env.TELEMETRY_SAMPLE_RATE || '0.1'),
    TELEMETRY_SALT: process.env.TELEMETRY_SALT || 'default-salt-change-in-production'
  },
  
  // Privacy settings
  PRIVACY: {
    SANITIZE_PII: process.env.TELEMETRY_PII_SANITIZATION !== 'false',
    ANONYMIZE_IPS: process.env.TELEMETRY_IP_ANONYMIZATION !== 'false',
    CONSENT_VERSION: process.env.TELEMETRY_CONSENT_VERSION || '1.0'
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
  consentVersion: TELEMETRY_CONFIG.PRIVACY.CONSENT_VERSION
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