export const WORKFLOW_BUNDLE_FORMAT = 'alga-psa.workflow-bundle' as const;
export const WORKFLOW_BUNDLE_FORMAT_VERSION_V1 = 1 as const;

export type WorkflowBundleHeaderV1 = {
  format: typeof WORKFLOW_BUNDLE_FORMAT;
  formatVersion: typeof WORKFLOW_BUNDLE_FORMAT_VERSION_V1;
  exportedAt: string; // ISO-8601 timestamp
};

export const createWorkflowBundleHeaderV1 = (exportedAt: Date = new Date()): WorkflowBundleHeaderV1 => ({
  format: WORKFLOW_BUNDLE_FORMAT,
  formatVersion: WORKFLOW_BUNDLE_FORMAT_VERSION_V1,
  exportedAt: exportedAt.toISOString()
});

