export type AnonymizationLevel = 'none' | 'partial' | 'full';

export interface TenantTelemetrySettings {
  enabled: boolean;
  anonymizationLevel: AnonymizationLevel;
}

