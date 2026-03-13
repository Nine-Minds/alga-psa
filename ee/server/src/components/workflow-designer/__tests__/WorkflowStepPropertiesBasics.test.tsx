/** @vitest-environment jsdom */

import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { WorkflowStepNameField } from '../WorkflowStepNameField';
import { WorkflowStepSaveOutputSection } from '../WorkflowStepSaveOutputSection';

const generateSaveAsName = (actionId: string) => actionId.replace(/\./g, '_');

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
});
