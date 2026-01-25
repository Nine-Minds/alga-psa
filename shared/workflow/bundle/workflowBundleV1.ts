export const WORKFLOW_BUNDLE_FORMAT = 'alga-psa.workflow-bundle' as const;
export const WORKFLOW_BUNDLE_FORMAT_VERSION_V1 = 1 as const;

export type WorkflowBundleHeaderV1 = {
  format: typeof WORKFLOW_BUNDLE_FORMAT;
  formatVersion: typeof WORKFLOW_BUNDLE_FORMAT_VERSION_V1;
  exportedAt: string; // ISO-8601 timestamp
};

export type WorkflowBundleWorkflowMetadataV1 = {
  name: string;
  description: string | null;
  payloadSchemaRef: string;
  payloadSchemaMode: 'inferred' | 'pinned' | string | null;
  pinnedPayloadSchemaRef: string | null;
  trigger: Record<string, unknown> | null;

  // Operational settings (mirrors workflow_definitions columns; see exporter/importer for fidelity rules).
  isSystem: boolean;
  isVisible: boolean;
  isPaused: boolean;
  concurrencyLimit: number | null;
  autoPauseOnFailure: boolean;
  failureRateThreshold: number | string | null;
  failureRateMinRuns: number | null;
  retentionPolicyOverride: Record<string, unknown> | null;
};

export type WorkflowBundleDraftV1 = {
  draftVersion: number;
  definition: Record<string, unknown>;
};

export type WorkflowBundlePublishedVersionV1 = {
  version: number;
  definition: Record<string, unknown>;
  payloadSchemaJson: Record<string, unknown> | null;
};

export type WorkflowBundleWorkflowV1 = {
  key: string;
  metadata: WorkflowBundleWorkflowMetadataV1;
  draft: WorkflowBundleDraftV1;
  publishedVersions: WorkflowBundlePublishedVersionV1[];
};

export type WorkflowBundleV1 = WorkflowBundleHeaderV1 & {
  workflows: WorkflowBundleWorkflowV1[];
};

export const createWorkflowBundleHeaderV1 = (exportedAt: Date = new Date()): WorkflowBundleHeaderV1 => ({
  format: WORKFLOW_BUNDLE_FORMAT,
  formatVersion: WORKFLOW_BUNDLE_FORMAT_VERSION_V1,
  exportedAt: exportedAt.toISOString()
});
