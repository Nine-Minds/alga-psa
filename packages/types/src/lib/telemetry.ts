export type AnonymizationLevel = 'none' | 'partial' | 'full';

export interface TenantTelemetrySettings {
  enabled: boolean;
  anonymizationLevel: AnonymizationLevel;
  allowUserOverride?: boolean;
  complianceNotes?: string;
  lastUpdated?: string;
  updatedBy?: string;
}

