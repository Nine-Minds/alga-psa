/** @vitest-environment jsdom */

import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../mapping', () => ({
  MappingPanel: ({ stepId }: { stepId: string }) => (
    <div data-testid={`mapping-panel-${stepId}`}>mapping-panel</div>
  ),
}));

import { WorkflowActionInputSection } from '../WorkflowActionInputSection';

describe('WorkflowActionInputSection', () => {
  it('T105/T106: keeps the completion summary above an inline action-input editor instead of a dialog opener', () => {
    render(
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
    expect(screen.getByTestId('mapping-panel-step-1')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit mapping' })).not.toBeInTheDocument();
  });
});
