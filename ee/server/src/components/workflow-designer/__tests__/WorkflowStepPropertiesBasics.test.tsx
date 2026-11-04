/** @vitest-environment jsdom */

import React, { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { WorkflowStepNameField } from '../WorkflowStepNameField';
import { WorkflowStepSaveOutputSection } from '../WorkflowStepSaveOutputSection';

const generateSaveAsName = (actionId: string) => actionId.replace(/\./g, '_');

// The designer writes whatever the section emits straight back into step config, so the
// harness echoes it to reproduce the controlled round-trip the real panel performs.
const SaveOutputHarness: React.FC<{
  initialSaveAs?: string;
  onSaveAsChange: (value?: string) => void;
}> = ({ initialSaveAs, onSaveAsChange }) => {
  const [saveAs, setSaveAs] = useState<string | undefined>(initialSaveAs);

  return (
    <WorkflowStepSaveOutputSection
      stepId="step-edit"
      actionId="tickets.create"
      saveAs={saveAs}
      onSaveAsChange={(value) => {
        setSaveAs(value);
        onSaveAsChange(value);
      }}
      onCopyPath={vi.fn()}
      generateSaveAsName={generateSaveAsName}
    />
  );
};

describe('workflow step properties basics', () => {
  afterEach(() => {
    cleanup();
  });

  it('T099/T100: keeps step naming and save-output controls available before and after action selection', () => {
    const onStepNameChange = vi.fn();
    const onSaveAsChange = vi.fn();
    const onCopyPath = vi.fn();

    const { rerender } = render(
      <div className="space-y-2">
        <WorkflowStepNameField
          stepId="step-1"
          value="Ticket"
          onChange={onStepNameChange}
        />
        <WorkflowStepSaveOutputSection
          stepId="step-1"
          onSaveAsChange={onSaveAsChange}
          onCopyPath={onCopyPath}
          generateSaveAsName={generateSaveAsName}
        />
      </div>
    );

    expect(screen.getByDisplayValue('Ticket')).toBeInTheDocument();
    expect(screen.getByRole('switch')).toBeInTheDocument();

    fireEvent.change(screen.getByDisplayValue('Ticket'), {
      target: { value: 'Ticket draft' },
    });
    expect(onStepNameChange).toHaveBeenLastCalledWith('Ticket draft');

    fireEvent.click(screen.getByRole('switch'));
    expect(onSaveAsChange).toHaveBeenLastCalledWith('result');

    rerender(
      <div className="space-y-2">
        <WorkflowStepNameField
          stepId="step-1"
          value="Create Ticket"
          onChange={onStepNameChange}
        />
        <WorkflowStepSaveOutputSection
          stepId="step-1"
          actionId="tickets.create"
          saveAs="tickets_create"
          onSaveAsChange={onSaveAsChange}
          onCopyPath={onCopyPath}
          generateSaveAsName={generateSaveAsName}
        />
      </div>
    );

    expect(screen.getByDisplayValue('Create Ticket')).toBeInTheDocument();
    expect(screen.getByRole('switch')).toBeChecked();
    expect(screen.getByDisplayValue('tickets_create')).toBeInTheDocument();
    expect(screen.getByText('vars.tickets_create')).toBeInTheDocument();

    fireEvent.change(screen.getByDisplayValue('tickets_create'), {
      target: { value: 'ticketResult' },
    });
    expect(onSaveAsChange).toHaveBeenLastCalledWith('ticketResult');

    fireEvent.click(screen.getByTitle('Copy full path'));
    expect(onCopyPath).toHaveBeenLastCalledWith('vars.tickets_create');
  });

  it('shows scoped save output paths without prepending vars', () => {
    const onSaveAsChange = vi.fn();
    const onCopyPath = vi.fn();

    render(
      <WorkflowStepSaveOutputSection
        stepId="scoped-step"
        actionId="transform.query_json"
        saveAs="payload.normalizedInbound"
        onSaveAsChange={onSaveAsChange}
        onCopyPath={onCopyPath}
        generateSaveAsName={generateSaveAsName}
      />
    );

    expect(screen.getByText('payload.normalizedInbound')).toBeInTheDocument();
    expect(screen.queryByText('vars.payload.normalizedInbound')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTitle('Copy full path'));
    expect(onCopyPath).toHaveBeenLastCalledWith('payload.normalizedInbound');
  });

  it('T296/T320: read-only grouped steps can still inspect step naming and transform outputs without editing them', () => {
    const onStepNameChange = vi.fn();
    const onSaveAsChange = vi.fn();
    const onCopyPath = vi.fn();

    render(
      <div className="space-y-2">
        <WorkflowStepNameField
          stepId="readonly-step"
          value="Transform ticket summary"
          onChange={onStepNameChange}
          disabled
        />
        <WorkflowStepSaveOutputSection
          stepId="readonly-step"
          actionId="transform.truncate_text"
          saveAs="shortSummary"
          onSaveAsChange={onSaveAsChange}
          onCopyPath={onCopyPath}
          generateSaveAsName={generateSaveAsName}
          disabled
        />
      </div>
    );

    expect(screen.getByDisplayValue('Transform ticket summary')).toBeDisabled();
    expect(document.getElementById('workflow-step-saveAs-toggle-readonly-step')).toBeDisabled();
    expect(screen.getByDisplayValue('shortSummary')).toBeDisabled();
    expect(screen.getByText('vars.shortSummary')).toBeInTheDocument();

    fireEvent.click(screen.getByTitle('Copy full path'));
    expect(onCopyPath).toHaveBeenLastCalledWith('vars.shortSummary');
    expect(onStepNameChange).not.toHaveBeenCalled();
    expect(onSaveAsChange).not.toHaveBeenCalled();
  });

  it('keeps the save output name input mounted and focused through clears and spaces', async () => {
    const user = userEvent.setup();
    const onSaveAsChange = vi.fn();

    render(<SaveOutputHarness initialSaveAs="tickets_create" onSaveAsChange={onSaveAsChange} />);

    const input = document.getElementById('workflow-step-saveAs-step-edit') as HTMLInputElement;
    await user.click(input);
    await user.clear(input);

    // Clearing used to flip the section off and unmount the field mid-edit.
    expect(document.getElementById('workflow-step-saveAs-step-edit')).toBe(input);
    expect(document.activeElement).toBe(input);
    expect(input.value).toBe('');
    expect(onSaveAsChange).toHaveBeenLastCalledWith('');

    await user.type(input, 'ticket result');

    expect(document.getElementById('workflow-step-saveAs-step-edit')).toBe(input);
    expect(document.activeElement).toBe(input);
    expect(input.value).toBe('ticket result');
    expect(onSaveAsChange).toHaveBeenLastCalledWith('ticket result');

    await user.clear(input);
    await user.type(input, ' ticketResult ');

    // The trailing space survives while typing and is trimmed on commit.
    expect(input.value).toBe(' ticketResult ');
    await user.tab();
    expect(onSaveAsChange).toHaveBeenLastCalledWith('ticketResult');
    expect((document.getElementById('workflow-step-saveAs-step-edit') as HTMLInputElement).value)
      .toBe('ticketResult');
  });

  it('turns save output off through the toggle and keeps an empty name editable', async () => {
    const user = userEvent.setup();
    const onSaveAsChange = vi.fn();

    render(<SaveOutputHarness initialSaveAs="tickets_create" onSaveAsChange={onSaveAsChange} />);

    const input = document.getElementById('workflow-step-saveAs-step-edit') as HTMLInputElement;
    await user.clear(input);
    await user.tab();

    // Committing an empty name clears the stored value but leaves the field in place.
    expect(onSaveAsChange).toHaveBeenLastCalledWith(undefined);
    expect(document.getElementById('workflow-step-saveAs-step-edit')).toBe(input);

    await user.type(input, 'retyped');
    expect(onSaveAsChange).toHaveBeenLastCalledWith('retyped');

    await user.click(screen.getByRole('switch'));
    expect(onSaveAsChange).toHaveBeenLastCalledWith(undefined);
    expect(document.getElementById('workflow-step-saveAs-step-edit')).toBeNull();
  });
});
