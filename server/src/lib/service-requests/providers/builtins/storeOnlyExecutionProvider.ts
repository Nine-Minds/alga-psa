import { SERVICE_REQUEST_EXECUTION_MODES } from '../../domain';
import type { ServiceRequestExecutionProvider } from '../contracts';

/**
 * Execution provider that retains the completed submission as its only outcome.
 *
 * The common submission service already persists the immutable submission row
 * (definition version snapshot, payload, attachments, requester/client) before
 * any provider runs, so this provider deliberately performs no downstream
 * work: no ticket, no workflow execution, no notification, and no redirect.
 * The submission simply completes as succeeded with null ticket/workflow ids
 * and stays retrievable through the existing history and detail surfaces.
 */
export const storeOnlyExecutionProvider: ServiceRequestExecutionProvider = {
  key: 'store-only',
  displayName: 'Store Only',
  executionMode: SERVICE_REQUEST_EXECUTION_MODES.STORE_ONLY,
  validateConfig() {
    return {
      isValid: true,
      errors: [],
      warnings: [],
    };
  },
  async execute() {
    return {
      status: 'succeeded',
    };
  },
};
