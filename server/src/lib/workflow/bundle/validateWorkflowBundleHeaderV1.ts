import { WORKFLOW_BUNDLE_FORMAT, WORKFLOW_BUNDLE_FORMAT_VERSION_V1 } from '@shared/workflow/bundle/workflowBundleV1';
import { WorkflowBundleImportError } from './workflowBundleImportErrors';

export const validateWorkflowBundleHeaderV1 = (bundle: unknown): void => {
  if (!bundle || typeof bundle !== 'object' || Array.isArray(bundle)) {
    throw new WorkflowBundleImportError('INVALID_BUNDLE', 'Workflow bundle must be a JSON object.', { status: 400 });
  }

  const obj = bundle as Record<string, unknown>;
  const format = obj.format;
  const formatVersion = obj.formatVersion;

  if (format !== WORKFLOW_BUNDLE_FORMAT) {
    throw new WorkflowBundleImportError(
      'UNSUPPORTED_FORMAT',
      `Unsupported workflow bundle format "${String(format)}" (expected "${WORKFLOW_BUNDLE_FORMAT}").`,
      { status: 400, details: { expectedFormat: WORKFLOW_BUNDLE_FORMAT, receivedFormat: format } }
    );
  }

  if (formatVersion !== WORKFLOW_BUNDLE_FORMAT_VERSION_V1) {
    throw new WorkflowBundleImportError(
      'UNSUPPORTED_FORMAT_VERSION',
      `Unsupported workflow bundle formatVersion ${String(formatVersion)} (expected ${WORKFLOW_BUNDLE_FORMAT_VERSION_V1}).`,
      { status: 400, details: { expectedFormatVersion: WORKFLOW_BUNDLE_FORMAT_VERSION_V1, receivedFormatVersion: formatVersion } }
    );
  }
};

