import { beforeEach, describe, expect, it } from 'vitest';
import {
  getServiceRequestTemplateProvider,
  resetServiceRequestProviderRegistry,
  validateBasicFormSchema,
} from '../../../lib/service-requests';

describe('CE starter template provider', () => {
  beforeEach(() => {
    resetServiceRequestProviderRegistry();
  });

  it('T001: exposes six CE-safe starter templates with valid basic form schemas', () => {
    const provider = getServiceRequestTemplateProvider('ce-starter-pack');

    expect(provider).toBeDefined();

    const templates = provider!.listTemplates();
    expect(templates.map((template) => template.id)).toEqual([
      'new-hire',
      'employee-offboarding',
      'access-request',
      'hardware-request',
      'software-license-request',
      'shared-mailbox-distribution-list',
    ]);

    for (const template of templates) {
      const draft = template.buildDraft();
      const validation = validateBasicFormSchema(draft.formSchema);

      expect(validation.isValid, `${template.id}: ${validation.errors.join(', ')}`).toBe(true);
      expect(draft.metadata.categoryId ?? null).toBeNull();
      expect(draft.providers).toEqual({
        executionProvider: 'ticket-only',
        executionConfig: draft.providers.executionConfig,
        formBehaviorProvider: 'basic',
        formBehaviorConfig: {},
        visibilityProvider: 'all-authenticated-client-users',
        visibilityConfig: {},
      });
      expect(draft.providers.executionConfig).toMatchObject({
        includeFormResponsesInDescription: true,
      });
    }
  });
});
