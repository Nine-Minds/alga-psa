import type { ServiceRequestDefinitionEditorData } from './definitionEditor';
import { storeOnlyExecutionProvider } from './providers/builtins/storeOnlyExecutionProvider';

/**
 * PostHog feature flag that gates NEW authoring/selection of the store-only
 * execution provider server-side.
 *
 * Scope decision (XO design session): when the flag is disabled, tenants
 * cannot newly select the store-only execution provider while authoring a
 * service request definition. Everything that already exists keeps working:
 * published store-only definitions stay in the portal catalog, submissions
 * against them still execute, migrations are untouched, and historical
 * submission reads remain available.
 */
export const SERVICE_REQUEST_STORE_ONLY_FEATURE_FLAG = 'service-request-store-only';

/**
 * True when the requested execution provider selection must be rejected
 * because it would newly adopt store-only while the feature flag is disabled.
 */
export function isBlockedStoreOnlySelection(
  executionProvider: string,
  storeOnlyAuthoringEnabled: boolean
): boolean {
  return !storeOnlyAuthoringEnabled && executionProvider === storeOnlyExecutionProvider.key;
}

/**
 * Removes the store-only execution provider from the editor's selectable
 * providers when the feature flag is disabled.
 *
 * Definitions that already use store-only keep the provider in their options
 * so the editor continues to render the current selection faithfully; the
 * flag only gates newly selecting it.
 */
export function applyStoreOnlyAuthoringGateToEditorData(
  data: ServiceRequestDefinitionEditorData,
  storeOnlyAuthoringEnabled: boolean
): ServiceRequestDefinitionEditorData {
  if (storeOnlyAuthoringEnabled) {
    return data;
  }

  if (data.execution.executionProvider === storeOnlyExecutionProvider.key) {
    return data;
  }

  return {
    ...data,
    execution: {
      ...data.execution,
      availableExecutionProviders: data.execution.availableExecutionProviders.filter(
        (provider) => provider.key !== storeOnlyExecutionProvider.key
      ),
    },
  };
}
