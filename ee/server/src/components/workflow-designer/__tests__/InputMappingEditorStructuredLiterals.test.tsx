/** @vitest-environment jsdom */

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { InputMappingEditor } from '../mapping/InputMappingEditor';
import type { MappingPositionsHandlers } from '../mapping/useMappingPositions';

vi.mock('@alga-psa/tenancy/actions', () => ({
  listTenantSecrets: vi.fn(() => new Promise(() => {})),
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

describe('InputMappingEditor structured literals', () => {
  it('T121/T125: nested object fields render as expandable groups and preserve child values when collapsed', () => {
    render(
      <InputMappingEditor
        value={{
          requester: {
            name: 'Alex',
            email: 'alex@example.com',
          },
        }}
        onChange={vi.fn()}
        targetFields={[
          {
            name: 'requester',
            type: 'object',
            required: true,
            children: [
              { name: 'name', type: 'string', required: true },
              { name: 'email', type: 'string', required: true },
            ],
          },
        ]}
        fieldOptions={[]}
        stepId="step-object"
        positionsHandlers={positionsHandlers}
      />
    );

    expect(screen.getByDisplayValue('Alex')).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('Collapse Object fields'));
    expect(screen.queryByDisplayValue('Alex')).not.toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('Expand Object fields'));
    expect(screen.getByDisplayValue('Alex')).toBeInTheDocument();
    expect(screen.getByDisplayValue('alex@example.com')).toBeInTheDocument();
  });

  it('T122/T126: nested object-array items render as expandable groups and preserve child values when collapsed', () => {
    render(
      <InputMappingEditor
        value={{
          notes: [
            {
              line1: 'First note',
              line2: 'Second line',
            },
          ],
        }}
        onChange={vi.fn()}
        targetFields={[
          {
            name: 'notes',
            type: 'array',
            children: [
              { name: 'line1', type: 'string', required: true },
              { name: 'line2', type: 'string' },
            ],
            constraints: {
              itemType: 'object',
            },
          },
        ]}
        fieldOptions={[]}
        stepId="step-array"
        positionsHandlers={positionsHandlers}
      />
    );

    expect(screen.getByDisplayValue('First note')).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('Collapse Item 1'));
    expect(screen.queryByDisplayValue('First note')).not.toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('Expand Item 1'));
    expect(screen.getByDisplayValue('First note')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Second line')).toBeInTheDocument();
  });

  it('T123: primitive arrays default to the structured fixed-value editor instead of raw JSON', () => {
    render(
      <InputMappingEditor
        value={{
          tags: ['alpha', 'beta'],
        }}
        onChange={vi.fn()}
        targetFields={[
          {
            name: 'tags',
            type: 'array',
            constraints: {
              itemType: 'string',
            },
          },
        ]}
        fieldOptions={[]}
        stepId="step-primitive-array"
        positionsHandlers={positionsHandlers}
      />
    );

    const listEditor = screen.getByPlaceholderText(
      'Enter one value per line, or comma-separated'
    ) as HTMLTextAreaElement;

    expect(listEditor).toBeInTheDocument();
    expect(listEditor.value).toContain('alpha');
    expect(listEditor.value).toContain('beta');
    expect(screen.queryByPlaceholderText('[]')).not.toBeInTheDocument();
  });
});
