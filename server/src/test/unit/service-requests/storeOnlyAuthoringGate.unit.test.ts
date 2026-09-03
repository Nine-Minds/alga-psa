import { describe, expect, it } from 'vitest';
import {
  SERVICE_REQUEST_STORE_ONLY_FEATURE_FLAG,
  applyStoreOnlyAuthoringGateToEditorData,
  isBlockedStoreOnlyAdoption,
  storeOnlyAuthoringDisabledMessage,
} from '../../../lib/service-requests/storeOnlyAuthoringGate';
import type { ServiceRequestDefinitionEditorData } from '../../../lib/service-requests/definitionEditor';

function buildEditorData(executionProvider: string): ServiceRequestDefinitionEditorData {
  return {
    definitionId: 'definition-1',
    lifecycleState: 'draft',
    basics: {
      name: 'Test definition',
      description: null,
      icon: null,
      categoryId: null,
      categoryName: null,
      sortOrder: 0,
      availableCategories: [],
    },
    linkage: {
      linkedServiceId: null,
      linkedServiceName: null,
    },
    form: {
      schema: {},
    },
    execution: {
      executionProvider,
      executionConfig: {},
      formBehaviorProvider: 'basic',
      formBehaviorConfig: {},
      visibilityProvider: 'all-authenticated-client-users',
      visibilityConfig: {},
      availableExecutionProviders: [
        { key: 'ticket-only', displayName: 'Ticket Only', executionMode: 'ticket-only' },
        { key: 'store-only', displayName: 'Store Only', executionMode: 'store-only' },
      ],
      availableFormBehaviorProviders: [],
      availableVisibilityProviders: [],
      showWorkflowExecutionConfigPanel: false,
      showAdvancedFormBehaviorConfigPanel: false,
    },
    publish: {
      publishedVersionNumber: null,
      publishedAt: null,
      publishedBy: null,
      draftUpdatedAt: new Date(0),
    },
  };
}

describe('isBlockedStoreOnlyAdoption', () => {
  it('blocks adopting store-only (select, duplicate source, publish draft) while the flag is disabled', () => {
    expect(isBlockedStoreOnlyAdoption('store-only', false)).toBe(true);
  });

  it('allows adopting store-only while the flag is enabled', () => {
    expect(isBlockedStoreOnlyAdoption('store-only', true)).toBe(false);
  });

  it('never blocks other execution providers', () => {
    expect(isBlockedStoreOnlyAdoption('ticket-only', false)).toBe(false);
    expect(isBlockedStoreOnlyAdoption('ticket-only', true)).toBe(false);
  });
});

describe('storeOnlyAuthoringDisabledMessage', () => {
  it('names the authoring act and the unlocking feature flag', () => {
    const message = storeOnlyAuthoringDisabledMessage('Publishing a store-only service request definition');

    expect(message).toBe(
      `Publishing a store-only service request definition requires the "${SERVICE_REQUEST_STORE_ONLY_FEATURE_FLAG}" feature flag`
    );
  });
});

describe('applyStoreOnlyAuthoringGateToEditorData', () => {
  it('removes store-only from the selectable providers when the flag is disabled', () => {
    const gated = applyStoreOnlyAuthoringGateToEditorData(buildEditorData('ticket-only'), false);

    expect(gated.execution.availableExecutionProviders.map((provider) => provider.key)).toEqual([
      'ticket-only',
    ]);
  });

  it('keeps store-only selectable when the flag is enabled', () => {
    const data = buildEditorData('ticket-only');
    const gated = applyStoreOnlyAuthoringGateToEditorData(data, true);

    expect(gated).toBe(data);
    expect(gated.execution.availableExecutionProviders.map((provider) => provider.key)).toEqual([
      'ticket-only',
      'store-only',
    ]);
  });

  it('keeps store-only visible for a definition that already uses it, even when disabled', () => {
    const data = buildEditorData('store-only');
    const gated = applyStoreOnlyAuthoringGateToEditorData(data, false);

    expect(gated).toBe(data);
    expect(gated.execution.availableExecutionProviders.map((provider) => provider.key)).toEqual([
      'ticket-only',
      'store-only',
    ]);
  });

  it('does not mutate the original editor data when filtering', () => {
    const data = buildEditorData('ticket-only');
    applyStoreOnlyAuthoringGateToEditorData(data, false);

    expect(data.execution.availableExecutionProviders.map((provider) => provider.key)).toEqual([
      'ticket-only',
      'store-only',
    ]);
  });
});
