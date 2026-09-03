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
 * True when an authoring act must be rejected because it would newly adopt
 * store-only while the feature flag is disabled. This covers every server-side
 * adoption path: selecting the provider on a draft, duplicating a definition
 * whose source uses it (the copy would be a new store-only definition), and
 * publishing a draft that uses it (a new store-only catalog surface).
 */
export function isBlockedStoreOnlyAdoption(
  executionProvider: string,
  storeOnlyAuthoringEnabled: boolean
): boolean {
  return !storeOnlyAuthoringEnabled && executionProvider === storeOnlyExecutionProvider.key;
}

/**
 * Shared human-readable reason used by every gate rejection so the UI and
 * error logs consistently name the flag that unlocks the path.
 */
export function storeOnlyAuthoringDisabledMessage(authoringAct: string): string {
  return `${authoringAct} requires the "${SERVICE_REQUEST_STORE_ONLY_FEATURE_FLAG}" feature flag`;
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
