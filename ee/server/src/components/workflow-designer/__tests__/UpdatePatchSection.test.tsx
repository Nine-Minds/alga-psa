/** @vitest-environment jsdom */

import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { InputMappingEditor, type ActionInputField } from '../mapping/InputMappingEditor';
import {
  formatWorkflowPatchChangeSummary,
  humanizeWorkflowPatchFieldLabel,
  isEditableWorkflowPatchValue,
  isWorkflowUpdatePatchField,
  summarizeWorkflowPatchChanges,
} from '../mapping/UpdatePatchSection';
import type { MappingPositionsHandlers } from '../mapping/useMappingPositions';

vi.mock('@alga-psa/tenancy/actions', () => ({
  listTenantSecrets: vi.fn(() => new Promise(() => {})),
}));

vi.mock('@alga-psa/integrations/actions', () => ({
  getTicketFieldOptions: vi.fn().mockResolvedValue({
    options: {
      boards: [],
      statuses: [],
      priorities: [],
      categories: [],
      clients: [],
      users: [],
      locations: [],
    },
  }),
}));

vi.mock('@alga-psa/clients/actions', () => ({
  getAllContacts: vi.fn().mockResolvedValue([]),
  getContactsByClient: vi.fn().mockResolvedValue([]),
}));

vi.mock('@alga-psa/teams/actions', () => ({
  getTeamsBasic: vi.fn().mockResolvedValue([]),
}));

const positionsHandlers: MappingPositionsHandlers = {
  registerSourceRef: vi.fn(),
  registerTargetRef: vi.fn(),
  setContainerRef: vi.fn(),
  registerScrollContainer: vi.fn(),
  unregisterScrollContainer: vi.fn(),
  recalculatePositions: vi.fn(),
  getSourcePosition: vi.fn(() => null),
  getTargetPosition: vi.fn(() => null),
  getConnections: vi.fn(() => []),
};

const updateTargetFields: ActionInputField[] = [
  { name: 'ticket_id', type: 'string', required: true },
  {
    name: 'patch',
    type: 'object',
    required: true,
    children: [
      { name: 'status_id', type: 'string', required: false },
      { name: 'priority_id', type: 'string', required: false },
      { name: 'assigned_to', type: 'string', required: false },
      { name: 'due_date', type: 'string', required: false },
    ],
  },
];

afterEach(() => {
  cleanup();
});

describe('update patch helpers', () => {
  it('detects an object input named patch with children as an update patch field', () => {
    expect(isWorkflowUpdatePatchField(updateTargetFields[1])).toBe(true);
    expect(isWorkflowUpdatePatchField({ name: 'patch', type: 'object' })).toBe(false);
    expect(isWorkflowUpdatePatchField({ name: 'requester', type: 'object', children: [{ name: 'x', type: 'string' }] })).toBe(false);
  });

  it('treats plain records and undefined as editable, whole-object references/expressions as not', () => {
    expect(isEditableWorkflowPatchValue(undefined)).toBe(true);
    expect(isEditableWorkflowPatchValue({ status_id: 'abc' })).toBe(true);
    expect(isEditableWorkflowPatchValue({ $expr: 'vars.step1.patch' })).toBe(false);
  });

  it('humanizes field names for summary labels', () => {
    expect(humanizeWorkflowPatchFieldLabel('status_id')).toBe('Status');
    expect(humanizeWorkflowPatchFieldLabel('due_date')).toBe('Due date');
  });

  it('summarizes configured changes and caps the label list with +N more', () => {
    const labels = summarizeWorkflowPatchChanges({
      status_id: 'a',
      priority_id: 'b',
      assigned_to: 'c',
      due_date: 'd',
    });
    expect(labels).toEqual(['Status', 'Priority', 'Assigned to', 'Due date']);

    const t = ((key: string, opts: Record<string, unknown>) =>
      String(opts.defaultValue)
        .replace('{{list}}', String(opts.list))
        .replace('{{count}}', String(opts.count))) as never;
    expect(formatWorkflowPatchChangeSummary(t, labels)).toBe(
      'Changes Status, Priority, Assigned to +1 more'
    );
    expect(formatWorkflowPatchChangeSummary(t, labels.slice(0, 2))).toBe(
      'Changes Status, Priority'
    );
  });
});

describe('InputMappingEditor update patch UX', () => {
  it('renders the summary-first patch card for update-style actions instead of a flat patch group', () => {
    render(
      <InputMappingEditor
        value={{ ticket_id: { $expr: 'vars.trigger.ticket_id' }, patch: { status_id: 'abc' } }}
        onChange={vi.fn()}
        targetFields={updateTargetFields}
        fieldOptions={[]}
        stepId="step-update"
        positionsHandlers={positionsHandlers}
      />
    );

    expect(document.querySelector('[data-automation-id="update-patch-step-update-summary"]')).toBeInTheDocument();
    expect(document.getElementById('update-patch-step-update-edit-changes')).toBeInTheDocument();
    // ticket_id still renders as a normal mapping row
    expect(
      document.getElementById('mapping-step-update-ticket_id-source-mode-container')
    ).toBeInTheDocument();
    // patch children are not rendered as a flat field pile
    expect(
      document.getElementById('mapping-step-update-patch.status_id-source-mode-container')
    ).not.toBeInTheDocument();
  });

  it('leaves non-update actions on the legacy editor', () => {
    render(
      <InputMappingEditor
        value={{}}
        onChange={vi.fn()}
        targetFields={[
          { name: 'title', type: 'string', required: true },
          {
            name: 'requester',
            type: 'object',
            required: false,
            children: [{ name: 'name', type: 'string', required: false }],
          },
        ]}
        fieldOptions={[]}
        stepId="step-create"
        positionsHandlers={positionsHandlers}
      />
    );

    expect(document.querySelector('[data-automation-id^="update-patch-"]')).not.toBeInTheDocument();
  });

  it('falls back to the generic editor when the whole patch is a reference/expression', () => {
    render(
      <InputMappingEditor
        value={{ ticket_id: 'abc', patch: { $expr: 'vars.step1.output' } }}
        onChange={vi.fn()}
        targetFields={updateTargetFields}
        fieldOptions={[]}
        stepId="step-ref"
        positionsHandlers={positionsHandlers}
      />
    );

    expect(document.querySelector('[data-automation-id="update-patch-step-ref-summary"]')).not.toBeInTheDocument();
    expect(
      document.getElementById('mapping-step-ref-patch-source-mode-container')
    ).toBeInTheDocument();
  });

  it('adds a change from the dialog catalog and emits only that patch key', () => {
    const onChange = vi.fn();
    render(
      <InputMappingEditor
        value={{ ticket_id: 'abc' }}
        onChange={onChange}
        targetFields={updateTargetFields}
        fieldOptions={[]}
        stepId="step-add"
        positionsHandlers={positionsHandlers}
      />
    );

    fireEvent.click(document.getElementById('update-patch-step-add-edit-changes')!);
    const catalogButton = document.getElementById('update-patch-step-add-catalog-status_id');
    expect(catalogButton).toBeInTheDocument();
    fireEvent.click(catalogButton!);

    expect(onChange).toHaveBeenCalledTimes(1);
    const emitted = onChange.mock.calls[0][0];
    expect(Object.keys(emitted.patch)).toEqual(['status_id']);
    expect(emitted.ticket_id).toBe('abc');
  });

  it('removing the last change row drops the patch key entirely', () => {
    const onChange = vi.fn();
    render(
      <InputMappingEditor
        value={{ ticket_id: 'abc', patch: { status_id: 'xyz' } }}
        onChange={onChange}
        targetFields={updateTargetFields}
        fieldOptions={[]}
        stepId="step-remove"
        positionsHandlers={positionsHandlers}
      />
    );

    fireEvent.click(document.getElementById('update-patch-step-remove-edit-changes')!);
    const removeButton = document.getElementById('update-patch-step-remove-remove-status_id');
    expect(removeButton).toBeInTheDocument();
    fireEvent.click(removeButton!);

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0].patch).toBeUndefined();
  });
});
