/** @vitest-environment jsdom */

import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@alga-psa/ui/components/SearchableSelect', () => import('./mocks/searchableSelectMock'));

import {
  buildWorkflowPickableFields,
  orderWorkflowPickableFields,
  toWorkflowFieldPickerOptions,
} from '../mapping/WorkflowFieldPicker';
import { WorkflowTextTemplateEditor } from '../mapping/WorkflowTextTemplateEditor';
import { WorkflowValueSourceChooser } from '../mapping/WorkflowValueSourceChooser';
import { createCaretIntent } from '../caretIntent';
import { buildDataContext } from '../workflowDataContext';
import { buildWorkflowReferenceFieldOptions } from '../workflowReferenceOptions';
import { buildWorkflowReferenceSourceTypeLookup } from '../workflowReferenceContext';
import type { WorkflowDataContext } from '../mapping/MappingPanel';
import type { WorkflowDefinition } from '@alga-psa/workflows/runtime/client';

afterEach(() => cleanup());

const labels = { trigger: 'Trigger', loop: 'Current loop item', error: 'Caught error', workflow: 'Workflow run' };
const context = {
  vars: [{ saveAs: 'ticketDetails', stepName: 'Find Ticket', fields: [] }],
  forEach: { itemVar: 'checklistItem', indexVar: 'index' },
} as never;

describe('workflow field picker', () => {
  it('labels every field with where it comes from and lists workflow bookkeeping last', () => {
    const fields = buildWorkflowPickableFields(
      [
        { value: 'meta.state', label: '🏷️ meta.state' },
        { value: 'payload', label: '📦 payload' },
        { value: 'payload.ticketId', label: 'Ticket (ticketId)' },
        { value: 'vars.ticketDetails.ticket_number', label: 'Ticket number (ticket.ticket_number)' },
        { value: 'checklistItem', label: 'checklistItem' },
      ],
      context,
      labels
    );
    expect(fields.map((field) => [field.path, field.sourceName])).toEqual([
      ['meta.state', 'Workflow run'],
      ['payload.ticketId', 'Trigger'],
      ['vars.ticketDetails.ticket_number', 'Find Ticket'],
      ['checklistItem', 'Current loop item'],
    ]);
    expect(fields[0].label).toBe('meta.state');
    expect(orderWorkflowPickableFields(fields).map((field) => field.path)).toEqual([
      'payload.ticketId',
      'vars.ticketDetails.ticket_number',
      'checklistItem',
      'meta.state',
    ]);
  });

  it('groups options by source and shows "Source › Field" when selected', () => {
    const [option] = toWorkflowFieldPickerOptions([
      { path: 'vars.ticketDetails.ticket_number', label: 'Ticket number', sourceName: 'Find Ticket' },
    ]);
    expect(option).toMatchObject({
      value: 'vars.ticketDetails.ticket_number',
      label: 'Ticket number',
      group: 'Find Ticket',
      triggerLabel: 'Find Ticket › Ticket number',
    });
    expect(option.keywords).toContain('vars.ticketDetails.ticket_number');
  });
});

describe('value source for a variable set by "Set variables"', () => {
  // Ticket Created → Set variables (senderEmail = payload.senderEmail) → Find Contact.
  const definition = {
    id: 'workflow-set-variables',
    version: 1,
    name: 'Set variables workflow',
    payloadSchemaRef: 'system:default',
    trigger: { type: 'event', eventName: 'ticket.created' },
    steps: [
      {
        id: 'set-vars',
        type: 'transform.assign',
        name: 'Set variables',
        config: { assign: { senderEmail: { $expr: 'payload.senderEmail' } } },
      },
      { id: 'find-contact', type: 'action.call', config: { actionId: 'contacts.find', version: 1 } },
    ],
  } as unknown as WorkflowDefinition;

  const buildFields = () => {
    const dataContext = buildDataContext(definition, 'find-contact', [], {
      type: 'object',
      properties: { senderEmail: { type: 'string' } },
    });
    const fieldOptions = buildWorkflowReferenceFieldOptions(dataContext.payloadSchema, dataContext);
    const sourceTypeMap = buildWorkflowReferenceSourceTypeLookup(dataContext as WorkflowDataContext, 'payload');
    const browseContext = {
      vars: dataContext.steps.map(({ stepId, stepName, saveAs }) => ({ stepId, stepName, saveAs, fields: [] })),
    } as never;
    return buildWorkflowPickableFields(fieldOptions, browseContext, labels, {
      typeOf: (path) => sourceTypeMap.get(path),
    });
  };

  it('lists the variable for a text input and fills the input with it', async () => {
    const onChooseField = vi.fn();
    const fields = buildFields();
    expect(fields.find((field) => field.path === 'vars.senderEmail')).toMatchObject({
      sourceName: 'Set variables',
      type: 'string',
    });

    render(
      <WorkflowValueSourceChooser
        idPrefix="mapping-find-contact-email"
        target={{ name: 'email', type: 'string' }}
        fields={fields}
        mode="fixed"
        selectedPath={null}
        isPlainText={false}
        onChooseField={onChooseField}
        onChooseMode={vi.fn()}
      />
    );

    const picker = screen.getByTestId('mapping-find-contact-email-value-source') as HTMLSelectElement;
    expect(Array.from(picker.options).map((option) => option.value)).toContain('vars.senderEmail');
    await act(async () => {
      fireEvent.change(picker, { target: { value: 'vars.senderEmail' } });
    });
    expect(onChooseField).toHaveBeenCalledWith('vars.senderEmail', 'vars.senderEmail');
  });

  it('finds the variable when searching for its name', async () => {
    const { rankSearchableSelectOptions } = await vi.importActual<
      typeof import('@alga-psa/ui/components/SearchableSelect')
    >('@alga-psa/ui/components/SearchableSelect');
    const options = toWorkflowFieldPickerOptions(buildFields());
    expect(rankSearchableSelectOptions(options, 'senderEmail').map((option) => option.value)).toContain(
      'vars.senderEmail'
    );
  });
});

describe('caret intent', () => {
  it('inserts at the end unless the author placed the caret', () => {
    const intent = createCaretIntent();
    const element = { selectionStart: 3, selectionEnd: 3 };
    // Never focused.
    expect(intent.insertionRange(element, 10)).toEqual({ start: 10, end: 10 });
    // The click that focuses the box doesn't count.
    intent.onFocus();
    intent.onMouseUp(element);
    expect(intent.insertionRange(element, 10)).toEqual({ start: 10, end: 10 });
    // A second click places the caret.
    intent.onMouseUp(element);
    expect(intent.insertionRange(element, 10)).toEqual({ start: 3, end: 3 });
    // Refocusing resets; Tab doesn't place it, End does.
    intent.onFocus();
    intent.onKeyDown('Tab');
    expect(intent.insertionRange(element, 10)).toEqual({ start: 10, end: 10 });
    intent.onKeyDown('End');
    expect(intent.insertionRange(element, 10)).toEqual({ start: 3, end: 3 });
  });

  it('Insert field appends to the text when the caret was only put there by focusing', async () => {
    const onChange = vi.fn();
    render(
      <WorkflowTextTemplateEditor
        idPrefix="tpl"
        template="Ticket escalated"
        onChange={onChange}
        fieldOptions={[{ value: 'payload.ticketNumber', label: 'Ticket number (ticketNumber)' }]}
      />
    );
    const input = document.getElementById('tpl-literal-str') as HTMLInputElement;
    input.setSelectionRange(3, 3);
    fireEvent.focus(input);
    fireEvent.mouseUp(input);

    const picker = screen.getByTestId('tpl-literal-str-insert-field');
    // One picker, grouped by source, the same as the value source and condition fields.
    expect(Array.from((picker as HTMLSelectElement).options).map((option) => option.textContent)).toContain(
      'Ticket number (ticketNumber)'
    );
    await act(async () => {
      fireEvent.change(picker, { target: { value: 'payload.ticketNumber' } });
    });
    const saved = onChange.mock.calls.at(-1)?.[0] as { $expr: string };
    expect(saved.$expr).toBe('"Ticket escalated" & payload.ticketNumber');
  });
});
