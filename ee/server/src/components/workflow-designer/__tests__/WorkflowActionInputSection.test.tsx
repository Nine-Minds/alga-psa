/** @vitest-environment jsdom */

import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../mapping', () => ({
  MappingPanel: ({
    stepId,
    value,
    disabled,
  }: {
    stepId: string;
    value: Record<string, unknown>;
    disabled?: boolean;
  }) => (
    <div
      data-testid={`mapping-panel-${stepId}`}
      data-disabled={disabled ? 'true' : 'false'}
    >
      {JSON.stringify(value)}
    </div>
  ),
}));

import { WorkflowActionInputSection } from '../WorkflowActionInputSection';

describe('WorkflowActionInputSection', () => {
  afterEach(() => {
    cleanup();
  });

  it('T105/T106/T120: keeps the completion summary above an inline action-input editor and updates it with field state', () => {
    const { rerender } = render(
      <WorkflowActionInputSection
        stepId="step-1"
        inputMapping={{}}
        onInputMappingChange={vi.fn()}
        targetFields={[
          { name: 'summary', type: 'string', required: true },
          { name: 'details', type: 'string' },
        ]}
        dataContext={{
          payload: [],
          payloadSchema: undefined,
          steps: [],
          globals: {
            env: [],
            secrets: [],
            meta: [],
            error: [],
          },
        }}
        fieldOptions={[]}
        mappedInputFieldCount={0}
        requiredActionInputFields={[{ name: 'summary', type: 'string', required: true }]}
        unmappedRequiredInputFieldCount={1}
      />
    );

    expect(screen.getByText('Action inputs')).toBeInTheDocument();
    expect(screen.getByText('0 / 2 fields configured')).toBeInTheDocument();
    expect(screen.getByText('1 required field still unmapped')).toBeInTheDocument();
    expect(screen.getByTestId('mapping-panel-step-1')).toHaveTextContent('{}');
    expect(screen.queryByRole('button', { name: 'Edit mapping' })).not.toBeInTheDocument();

    rerender(
      <WorkflowActionInputSection
        stepId="step-1"
        inputMapping={{ summary: 'done' }}
        onInputMappingChange={vi.fn()}
        targetFields={[
          { name: 'summary', type: 'string', required: true },
          { name: 'details', type: 'string' },
        ]}
        dataContext={{
          payload: [],
          payloadSchema: undefined,
          steps: [],
          globals: {
            env: [],
            secrets: [],
            meta: [],
            error: [],
          },
        }}
        fieldOptions={[]}
        mappedInputFieldCount={1}
        requiredActionInputFields={[{ name: 'summary', type: 'string', required: true }]}
        unmappedRequiredInputFieldCount={0}
      />
    );

    expect(screen.getByText('1 / 2 fields configured')).toBeInTheDocument();
    expect(screen.getByText('All 1 required fields are mapped')).toBeInTheDocument();
  });

  it('T223/T238: transform grouped steps reuse the inline action-input section and validation summary', () => {
    render(
      <WorkflowActionInputSection
        stepId="transform-step"
        inputMapping={{ maxLength: 24 }}
        onInputMappingChange={vi.fn()}
        targetFields={[
          { name: 'text', type: 'string', required: true },
          { name: 'maxLength', type: 'number', required: true },
          { name: 'strategy', type: 'string', enum: ['end', 'start', 'middle'] },
        ]}
        dataContext={{
          payload: [],
          payloadSchema: undefined,
          steps: [],
          globals: {
            env: [],
            secrets: [],
            meta: [],
            error: [],
          },
        }}
        fieldOptions={[]}
        mappedInputFieldCount={1}
        requiredActionInputFields={[
          { name: 'text', type: 'string', required: true },
          { name: 'maxLength', type: 'number', required: true },
        ]}
        unmappedRequiredInputFieldCount={1}
      />
    );

    expect(screen.getByText('Action inputs')).toBeInTheDocument();
    expect(screen.getByText('1 / 3 fields configured')).toBeInTheDocument();
    expect(screen.getByText('1 required field still unmapped')).toBeInTheDocument();
    expect(screen.getByTestId('mapping-panel-transform-step')).toHaveTextContent('{"maxLength":24}');
  });

  it('T293: app grouped steps reuse the same inline field editor model when their schemas are compatible', () => {
    render(
      <WorkflowActionInputSection
        stepId="app-step"
        inputMapping={{ channel: 'ops-alerts' }}
        onInputMappingChange={vi.fn()}
        targetFields={[
          { name: 'channel', type: 'string', required: true },
          { name: 'message', type: 'string', required: true },
          { name: 'thread_ts', type: 'string' },
        ]}
        dataContext={{
          payload: [],
          payloadSchema: undefined,
          steps: [],
          globals: {
            env: [],
            secrets: [],
            meta: [],
            error: [],
          },
        }}
        fieldOptions={[]}
        mappedInputFieldCount={1}
        requiredActionInputFields={[
          { name: 'channel', type: 'string', required: true },
          { name: 'message', type: 'string', required: true },
        ]}
        unmappedRequiredInputFieldCount={1}
      />
    );

    expect(screen.getByText('Action inputs')).toBeInTheDocument();
    expect(screen.getByText('1 / 3 fields configured')).toBeInTheDocument();
    expect(screen.getByText('1 required field still unmapped')).toBeInTheDocument();
    expect(screen.getByTestId('mapping-panel-app-step')).toHaveTextContent('{"channel":"ops-alerts"}');
  });

  it('T295/T296: keeps inline field state visible for read-only grouped steps while disabling edits', () => {
    render(
      <WorkflowActionInputSection
        stepId="readonly-step"
        inputMapping={{ summary: 'Existing summary' }}
        onInputMappingChange={vi.fn()}
        targetFields={[
          { name: 'summary', type: 'string', required: true },
          { name: 'details', type: 'string' },
        ]}
        dataContext={{
          payload: [],
          payloadSchema: undefined,
          steps: [],
          globals: {
            env: [],
            secrets: [],
            meta: [],
            error: [],
          },
        }}
        fieldOptions={[]}
        mappedInputFieldCount={1}
        requiredActionInputFields={[{ name: 'summary', type: 'string', required: true }]}
        unmappedRequiredInputFieldCount={0}
        disabled
      />
    );

    expect(screen.getByText('Action inputs')).toBeInTheDocument();
    expect(screen.getByText('1 / 2 fields configured')).toBeInTheDocument();
    expect(screen.getByText('All 1 required fields are mapped')).toBeInTheDocument();
    expect(screen.getByTestId('mapping-panel-readonly-step')).toHaveAttribute('data-disabled', 'true');
    expect(screen.getByTestId('mapping-panel-readonly-step')).toHaveTextContent(
      '{"summary":"Existing summary"}'
    );
  });
});
