// Telemetry configuration with privacy-first defaults
export const TELEMETRY_CONFIG = {
  CATEGORIES: {
    ERROR_TRACKING: 'error_tracking',
    PERFORMANCE_METRICS: 'performance_metrics', 
    USAGE_ANALYTICS: 'usage_analytics',
    SYSTEM_METRICS: 'system_metrics'
  },
  
  // Default to all disabled - users must explicitly opt-in
  DEFAULT_PREFERENCES: {
    error_tracking: false,
    performance_metrics: false,
    usage_analytics: false,
    system_metrics: false
  },
  
  ENVIRONMENT_OVERRIDES: {
    TELEMETRY_ENABLED: process.env.TELEMETRY_ENABLED === 'true',
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
export type TelemetryPreferences = Record<string, boolean> & {
  last_updated?: string;
  consent_version?: string;
};