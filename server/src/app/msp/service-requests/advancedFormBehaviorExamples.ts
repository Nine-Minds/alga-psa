/**
 * Copy-paste examples for the "Show or hide fields (advanced)" JSON panel.
 *
 * Kept out of the locale files: JSON is language-neutral. Field keys are illustrative.
 * Each example is exercised against the real publish-time validation in
 * `advancedFormBehaviorExamples.test.ts`.
 */
export interface AdvancedFormBehaviorExample {
  /** Suffix of the `editor.execution.advanced.help.examples.<id>.*` translation keys. */
  id: 'showWhen' | 'hideWhen' | 'prefill';
  config: Record<string, unknown>;
}

export const ADVANCED_FORM_BEHAVIOR_EXAMPLES: ReadonlyArray<AdvancedFormBehaviorExample> = [
  {
    id: 'showWhen',
    config: {
      visibilityRules: [
        { fieldKey: 'tell_us_more', source: 'reason', operator: 'equals', value: 'Other' },
      ],
    },
  },
  {
    id: 'hideWhen',
    config: {
      visibilityRules: [{ fieldKey: 'company', source: 'i_am_end_user', operator: 'is-false' }],
    },
  },
  {
    id: 'prefill',
    config: {
      visibilityRules: [{ fieldKey: 'client', source: 'context.clientId', operator: 'is-empty' }],
      contextDefaults: { client: '{{clientId}}' },
    },
  },
];

export const CONTEXT_DEFAULT_PLACEHOLDERS = ['clientId', 'contactId', 'requesterUserId'] as const;

export const VISIBILITY_RULE_SHAPE = 'visibilityRules: [{ fieldKey, source, operator, value? }]';
