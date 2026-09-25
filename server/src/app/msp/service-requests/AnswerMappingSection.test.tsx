// @vitest-environment jsdom
import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { TFunction } from 'i18next';
import { AnswerMappingSection } from './AnswerMappingSection';

const actions = vi.hoisted(() => ({
  get: vi.fn(),
  removeMany: vi.fn(),
}));

vi.mock('./actions', () => ({
  getServiceRequestAnswerMappingEditorDataAction: actions.get,
  removeServiceRequestAnswerMappingRulesAction: actions.removeMany,
}));

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({ t: (_key: string, options?: { defaultValue?: string; count?: number }) =>
    options?.defaultValue ?? String(options?.count ?? '') }),
}));

const rules = Array.from({ length: 11 }, (_, index) => ({
  ruleId: `rule-${index + 1}`,
  questionKey: `question_${index + 1}`,
  destinationKind: 'account',
  targetFieldKey: 'client_name',
}));

function editorData(nextRules = rules) {
  return {
    mappingId: 'mapping-1',
    definitionId: 'definition-1',
    lifecycleState: 'published',
    currentVersionId: 'version-1',
    publishedVersionNumber: 1,
    publishedAt: null,
    hasUnpublishedChanges: false,
    rules: nextRules,
    targetFieldCatalog: [{ kind: 'account', kindDisplayName: 'Account', fields: [{ fieldKey: 'client_name', displayLabel: 'Account name', dataType: 'string' }] }],
  };
}

const labels: Record<string, string> = {
  'editor.answerMapping.title': 'Answer Mapping',
  'editor.answerMapping.description': 'Map questions to fields',
  'editor.answerMapping.columns.question': 'Question',
  'editor.answerMapping.columns.destination': 'Destination',
  'editor.answerMapping.columns.field': 'Field',
  'editor.answerMapping.columns.selector': 'Asset selection',
  'editor.answerMapping.columns.actions': 'Actions',
  'editor.answerMapping.selection.selectPage': 'Select rules on this page',
  'editor.answerMapping.selection.removeSelected': 'Remove selected',
  'editor.answerMapping.selection.clear': 'Clear',
  'editor.answerMapping.selection.confirmTitle': 'Remove selected rules?',
  'editor.answerMapping.selection.confirmMessage': 'Remove selected draft rules?',
  'editor.answerMapping.selectorSummary.account': 'Submission account',
  'editor.answerMapping.addRule': 'Add rule',
  'editor.answerMapping.publish': 'Publish mapping',
  'editor.answerMapping.noRules': 'No mapping rules yet.',
  'editor.answerMapping.cancel': 'Cancel',
};

const t = ((key: string, options?: { count?: number; question?: string; version?: number }) => {
  if (key === 'editor.answerMapping.selection.selectRule') return `Select ${options?.question}`;
  if (key === 'editor.answerMapping.selection.selectedCount') return `${options?.count} selected`;
  if (key === 'editor.answerMapping.state.published') return `Published v${options?.version}`;
  return labels[key] ?? key;
}) as TFunction;

describe('Answer Mapping rule list', () => {
  it('selects across pages and removes the selected draft rules in one action', async () => {
    actions.get.mockResolvedValue(editorData());
    actions.removeMany.mockResolvedValue(editorData([]));
    render(
      <AnswerMappingSection
        definitionId="definition-1"
        questions={rules.map((rule) => ({ key: rule.questionKey, label: rule.questionKey }))}
        t={t}
        formatDate={() => ''}
      />
    );

    const table = await screen.findByRole('table');
    await waitFor(() => expect(within(table).getAllByRole('row')).toHaveLength(11));
    fireEvent.click(within(table).getByRole('checkbox', { name: 'Select rules on this page' }));
    expect(screen.getByText('10 selected')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '2' }));
    await waitFor(() => expect(within(table).getAllByRole('row')).toHaveLength(2));
    fireEvent.click(within(table).getByRole('checkbox', { name: 'Select rules on this page' }));
    expect(screen.getByText('11 selected')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Remove selected' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove selected' }));

    await waitFor(() => expect(actions.removeMany).toHaveBeenCalledWith(
      'definition-1',
      rules.map((rule) => rule.ruleId)
    ));
    await waitFor(() => expect(screen.getByText('No mapping rules yet.')).toBeTruthy());
    expect(screen.queryByText('11 selected')).toBeNull();
  });
});
