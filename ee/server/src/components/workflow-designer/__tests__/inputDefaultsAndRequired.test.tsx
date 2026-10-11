/** @vitest-environment jsdom */

import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

vi.mock('@alga-psa/ui/components/SearchableSelect', () => import('./mocks/searchableSelectMock'));
vi.mock('@alga-psa/tenancy/actions', () => ({
  listTenantSecrets: vi.fn(() => new Promise(() => {})),
}));
vi.mock('@alga-psa/integrations/actions', () => ({
  getTicketFieldOptions: vi.fn().mockResolvedValue({
    options: { boards: [], statuses: [], priorities: [], categories: [], clients: [], users: [], locations: [] },
  }),
}));
vi.mock('@alga-psa/clients/actions', () => ({
  getAllContacts: vi.fn().mockResolvedValue([]),
  getContactsByClient: vi.fn().mockResolvedValue([]),
}));
vi.mock('@alga-psa/teams/actions', () => ({
  getTeamsBasic: vi.fn().mockResolvedValue([]),
}));

import {
  WORKFLOW_COMMENT_VISIBILITY_LABELS,
  withWorkflowExplicitChoice,
  zodToWorkflowJsonSchema,
} from '@alga-psa/shared/workflow/runtime/jsonSchemaMetadata';
import { buildActionInputEditorState, type WorkflowDesignerActionRegistryItem } from '../actionInputEditorState';
import { buildDefaultWorkflowActionInputLiteralValue } from '../WorkflowActionInputSourceMode';
import { countMissingRequiredInputs } from '../mapping/mappingValueState';
import { InputMappingEditor } from '../mapping/InputMappingEditor';
import { selectBulkApplicableSuggestions, findAutoMappingSuggestions } from '../mapping/autoMappingSuggestions';

afterEach(() => cleanup());

const addCommentAction: WorkflowDesignerActionRegistryItem = {
  id: 'tickets.add_comment',
  version: 1,
  inputSchema: zodToWorkflowJsonSchema(
    z.object({
      ticket_id: z.string().uuid().describe('Ticket id'),
      body: z.string().min(1).describe('Comment body'),
      visibility: withWorkflowExplicitChoice(
        z.enum(['public', 'internal']).default('public'),
        'Who can see this comment',
        'Who can see this comment?',
        WORKFLOW_COMMENT_VISIBILITY_LABELS
      ),
    })
  ) as WorkflowDesignerActionRegistryItem['inputSchema'],
  outputSchema: { type: 'object', properties: {} },
};

const stateFor = (inputMapping: Record<string, unknown>) =>
  buildActionInputEditorState(
    { type: 'action.call', config: { actionId: 'tickets.add_comment', version: 1, inputMapping } },
    [addCommentAction]
  );

describe('starting values', () => {
  it('starts a yes/no the author sets at yes, and auto-filled ones at no', () => {
    expect(buildDefaultWorkflowActionInputLiteralValue({ type: 'boolean' }, { chosen: true })).toBe(true);
    expect(buildDefaultWorkflowActionInputLiteralValue({ type: 'boolean' })).toBe(false);
    expect(buildDefaultWorkflowActionInputLiteralValue({ type: 'boolean', default: false }, { chosen: true })).toBe(false);
  });

  it('starts numbers inside the allowed range', () => {
    expect(buildDefaultWorkflowActionInputLiteralValue({ type: 'integer', constraints: { minimum: 1, maximum: 200 } })).toBe(1);
    expect(buildDefaultWorkflowActionInputLiteralValue({ type: 'number', constraints: { maximum: -5 } })).toBe(-5);
    expect(buildDefaultWorkflowActionInputLiteralValue({ type: 'integer', default: 50, constraints: { minimum: 1 } })).toBe(50);
  });

  it('fills only the required sub-fields of a new object', () => {
    expect(buildDefaultWorkflowActionInputLiteralValue({
      type: 'object',
      children: [
        { name: 'body', type: 'string', required: true },
        { name: 'limit', type: 'integer', default: 50 },
        { name: 'visibility', type: 'string', required: true, enum: ['public', 'internal'], explicitChoice: { prompt: '?' } },
      ],
    })).toEqual({ body: '' });
  });
});

describe('comment visibility is an explicit choice', () => {
  it('is required in the designer, with no prefilled value, while the runtime default is unchanged', () => {
    const state = stateFor({ ticket_id: 'abc', body: 'Hi' });
    const visibility = state.actionInputFields.find((field) => field.name === 'visibility');
    expect(visibility).toMatchObject({ required: true, explicitChoice: { prompt: 'Who can see this comment?' } });
    expect(visibility?.default).toBeUndefined();
    expect(buildDefaultWorkflowActionInputLiteralValue(visibility!, { chosen: true })).toBe('');
    expect(state.unmappedRequiredInputFieldCount).toBe(1);
    // A workflow saved without a choice still runs as before: the action's own default applies.
    expect(z.object({ visibility: z.enum(['public', 'internal']).default('public') }).parse({}).visibility).toBe('public');
  });

  it('offers the options as buttons, never fills one in for the author', () => {
    const onChange = vi.fn();
    const fields = stateFor({}).actionInputFields;
    render(
      <InputMappingEditor
        value={{ ticket_id: 'abc', body: 'Hi' }}
        onChange={onChange}
        targetFields={fields}
        fieldOptions={[{ value: 'vars.otherComment.visibility', label: 'vars.otherComment.visibility' }]}
        stepId="step-comment"
      />
    );
    expect(document.getElementById('add-mapping-step-comment-visibility')).not.toBeInTheDocument();
    expect(screen.getByText('Who can see this comment?')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Internal: only your team can see it'));
    expect(onChange).toHaveBeenLastCalledWith({ ticket_id: 'abc', body: 'Hi', visibility: 'internal' });

    const suggestions = findAutoMappingSuggestions(fields, [{ path: 'vars.otherComment.visibility', type: 'string' }], {});
    expect(selectBulkApplicableSuggestions(suggestions, fields, () => false).map((s) => s.targetField)).not.toContain('visibility');
  });
});

describe('required count', () => {
  it('the step card and the input panel count the same required inputs, nested ones included', () => {
    const fields = [
      { name: 'ticket_id', type: 'string', required: true },
      {
        name: 'assignment',
        type: 'object',
        required: true,
        children: [
          { name: 'type', type: 'string', required: true },
          { name: 'id', type: 'string', required: true },
        ],
      },
    ];
    const mapping = { ticket_id: 'abc', assignment: { type: 'user' } };
    expect(countMissingRequiredInputs(fields, mapping)).toBe(1);

    render(
      <InputMappingEditor value={mapping} onChange={vi.fn()} targetFields={fields} fieldOptions={[]} stepId="step-assign" />
    );
    expect(screen.getByText('1 required missing')).toBeInTheDocument();
  });
});
