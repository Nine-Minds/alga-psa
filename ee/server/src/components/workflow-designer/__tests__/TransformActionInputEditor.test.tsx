/** @vitest-environment jsdom */

import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

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

vi.mock('@alga-psa/ui/components/CustomSelect', () => ({
  __esModule: true,
  default: ({
    id,
    options,
    value,
    onValueChange,
    disabled,
  }: {
    id?: string;
    options: Array<{ value: string; label: string }>;
    value?: string;
    onValueChange?: (value: string) => void;
    disabled?: boolean;
  }) => (
    <select
      data-testid={id}
      value={value ?? ''}
      disabled={disabled}
      onChange={(event) => onValueChange?.(event.target.value)}
    >
      <option value="">--</option>
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  ),
}));

import { InputMappingEditor } from '../mapping/InputMappingEditor';
import type { MappingPositionsHandlers } from '../mapping/useMappingPositions';
import type { InputMapping } from '@alga-psa/workflows/runtime/client';

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

afterEach(() => {
  cleanup();
});

describe('transform action input editor', () => {
  const TransformEditorHarness = ({
    initialValue,
    targetFields,
    fieldOptions = [],
    stepId = 'step-transform-inputs',
  }: {
    initialValue: InputMapping;
    targetFields: React.ComponentProps<typeof InputMappingEditor>['targetFields'];
    fieldOptions?: React.ComponentProps<typeof InputMappingEditor>['fieldOptions'];
    stepId?: string;
  }) => {
    const [value, setValue] = React.useState<InputMapping>(initialValue);

    return (
      <InputMappingEditor
        value={value}
        onChange={setValue}
        targetFields={targetFields}
        fieldOptions={fieldOptions}
        stepId={stepId}
        positionsHandlers={positionsHandlers}
      />
    );
  };

  it('T236/T242/T243/T259/T260: text transform actions use structured references plus fixed numeric and enum parameter controls', async () => {
    const onChange = vi.fn();

    await act(async () => {
      render(
        <InputMappingEditor
          value={{
            text: { $expr: 'payload.summary' },
            maxLength: 24,
            strategy: 'middle',
          }}
          onChange={onChange}
          targetFields={[
            {
              name: 'text',
              type: 'string',
              required: true,
            },
            {
              name: 'maxLength',
              type: 'number',
              required: true,
            },
            {
              name: 'strategy',
              type: 'string',
              enum: ['end', 'start', 'middle'],
            },
          ]}
          fieldOptions={[
            { value: 'payload.summary', label: 'payload.summary' },
            { value: 'payload.ticket.id', label: 'payload.ticket.id' },
          ]}
          stepId="step-transform-inputs"
          positionsHandlers={positionsHandlers}
        />
      );
    });

    expect(screen.getByTestId('mapping-step-transform-inputs-text-source-mode')).toBeInTheDocument();
    expect(screen.getByTestId('mapping-step-transform-inputs-maxLength-source-mode')).toBeInTheDocument();
    expect(screen.getByTestId('mapping-step-transform-inputs-text-reference-field')).toBeInTheDocument();

    expect(screen.getByText('maxLength')).toBeInTheDocument();
    expect(screen.getByText('strategy')).toBeInTheDocument();
    expect(screen.getByTestId('mapping-step-transform-inputs-maxLength-source-mode')).toHaveValue(
      'fixed'
    );
    expect(screen.getByTestId('mapping-step-transform-inputs-strategy-source-mode')).toHaveValue(
      'fixed'
    );

    await act(async () => {
      fireEvent.change(screen.getByTestId('mapping-step-transform-inputs-text-reference-scope'), {
        target: { value: 'payload' },
      });
      fireEvent.change(screen.getByTestId('mapping-step-transform-inputs-text-reference-field'), {
        target: { value: 'payload.ticket.id' },
      });
    });

    expect(onChange).toHaveBeenCalledWith({
      text: { $expr: 'payload.ticket.id' },
      maxLength: 24,
      strategy: 'middle',
    });
  });

  it('T237: transform input fields show type-compatibility hints like business action fields', async () => {
    render(
      <InputMappingEditor
        value={{
          text: { $expr: 'payload.ticket' },
          maxLength: 24,
        }}
        onChange={vi.fn()}
        targetFields={[
          {
            name: 'text',
            type: 'string',
            required: true,
          },
          {
            name: 'maxLength',
            type: 'number',
            required: true,
          },
        ]}
        fieldOptions={[{ value: 'payload.ticket', label: 'Payload ticket' }]}
        stepId="step-transform-hints"
        positionsHandlers={positionsHandlers}
        sourceTypeMap={new Map([['payload.ticket', 'object']])}
      />
    );

    await waitFor(() => {
      expect(
        screen.getByText('Type "object" is incompatible with expected "string"')
      ).toBeInTheDocument();
    });
  });

  it('renders a textarea for fixed multiline string inputs and keeps single-line inputs for ordinary strings', async () => {
    await act(async () => {
      render(
        <InputMappingEditor
          value={{
            prompt: 'Line 1\nLine 2',
            subject: 'Short subject',
          }}
          onChange={vi.fn()}
          targetFields={[
            {
              name: 'prompt',
              type: 'string',
              required: true,
              editor: {
                kind: 'text',
                inline: {
                  mode: 'textarea',
                },
              },
            },
            {
              name: 'subject',
              type: 'string',
              required: true,
            },
          ]}
          fieldOptions={[]}
          stepId="step-multiline-inputs"
          positionsHandlers={positionsHandlers}
        />
      );
    });

    const promptControl = document.getElementById(
      'mapping-step-multiline-inputs-prompt-literal-str'
    );
    const subjectControl = document.getElementById(
      'mapping-step-multiline-inputs-subject-literal-str'
    );

    expect(promptControl?.tagName).toBe('TEXTAREA');
    expect(subjectControl?.tagName).toBe('INPUT');
  });

  it('T263/T274/T275: build-object supports user-defined keys plus structured references and fixed literals for each field source', async () => {
    await act(async () => {
      render(
        <TransformEditorHarness
          initialValue={{
            fields: [
              {
                key: 'ticketId',
                value: { $expr: 'payload.ticket.id' },
              },
              {
                key: 'ticketSummary',
                value: 'Escalate printer issue',
              },
            ],
          }}
          targetFields={[
            {
              name: 'fields',
              type: 'array',
              children: [
                {
                  name: 'key',
                  type: 'string',
                  required: true,
                },
                {
                  name: 'value',
                  type: 'string',
                },
              ],
              constraints: {
                itemType: 'object',
              },
            },
          ]}
          fieldOptions={[
            { value: 'payload.ticket.id', label: 'payload.ticket.id' },
            { value: 'payload.ticket.summary', label: 'payload.ticket.summary' },
          ]}
          stepId="step-build-object"
        />
      );
    });

    expect(screen.getByDisplayValue('ticketId')).toBeInTheDocument();
    expect(
      document.getElementById('mapping-step-build-object-fields[1].key-literal-str')
    ).toHaveValue('ticketSummary');
    expect(
      screen.getByTestId('mapping-step-build-object-fields[0].value-source-mode')
    ).toHaveValue('reference');
    expect(screen.getByTestId('mapping-step-build-object-fields[0].value-reference-field')).toBeInTheDocument();
    expect(
      screen.getByTestId('mapping-step-build-object-fields[1].value-source-mode')
    ).toHaveValue('fixed');
    expect(
      document.getElementById('mapping-step-build-object-fields[1].value-literal-str')
    ).toBeInTheDocument();

    await act(async () => {
      fireEvent.change(screen.getByDisplayValue('ticketId'), {
        target: { value: 'ticketSummary' },
      });
      fireEvent.change(screen.getByTestId('mapping-step-build-object-fields[0].value-reference-scope'), {
        target: { value: 'payload' },
      });
      fireEvent.change(screen.getByTestId('mapping-step-build-object-fields[0].value-reference-field'), {
        target: { value: 'payload.ticket.summary' },
      });
      fireEvent.change(screen.getByDisplayValue('Escalate printer issue'), {
        target: { value: 'Escalate again' },
      });
    });

    expect(
      document.getElementById('mapping-step-build-object-fields[0].key-literal-str')
    ).toHaveValue('ticketSummary');
    expect(
      screen.getByTestId('mapping-step-build-object-fields[0].value-reference-field')
    ).toHaveValue('payload.ticket.summary');
    expect(screen.getByDisplayValue('Escalate again')).toBeInTheDocument();
  });

  it('T276: rename-fields exposes explicit structured rename rows instead of requiring expression editing', async () => {
    await act(async () => {
      render(
        <TransformEditorHarness
          initialValue={{
            source: { $expr: 'vars.ticketResult' },
            renames: [{ from: 'ticket_id', to: 'ticketId' }],
          }}
          targetFields={[
            {
              name: 'source',
              type: 'object',
            },
            {
              name: 'renames',
              type: 'array',
              children: [
                {
                  name: 'from',
                  type: 'string',
                  required: true,
                },
                {
                  name: 'to',
                  type: 'string',
                  required: true,
                },
              ],
              constraints: {
                itemType: 'object',
              },
            },
          ]}
          fieldOptions={[{ value: 'vars.ticketResult', label: 'vars.ticketResult' }]}
          stepId="step-rename-fields"
        />
      );
    });

    expect(screen.getByDisplayValue('ticket_id')).toBeInTheDocument();
    expect(screen.getByDisplayValue('ticketId')).toBeInTheDocument();
    expect(
      screen.getByTestId('mapping-step-rename-fields-renames[0].from-source-mode')
    ).toHaveValue('fixed');
    expect(
      screen.getByTestId('mapping-step-rename-fields-renames[0].to-source-mode')
    ).toHaveValue('fixed');
    expect(
      screen.getByTestId('mapping-step-rename-fields-source-reference-field')
    ).toHaveValue('vars.ticketResult');
    expect(
      screen.queryByTestId('mapping-step-rename-fields-renames[0].from-picker')
    ).not.toBeInTheDocument();
  });

  it('T277: pick-fields exposes a structured fixed field list instead of raw JSON entry', async () => {
    await act(async () => {
      render(
        <TransformEditorHarness
          initialValue={{
            source: { $expr: 'vars.ticketResult' },
            fields: ['ticket_id', 'updated'],
          }}
          targetFields={[
            {
              name: 'source',
              type: 'object',
            },
            {
              name: 'fields',
              type: 'array',
              constraints: {
                itemType: 'string',
              },
            },
          ]}
          fieldOptions={[{ value: 'vars.ticketResult', label: 'vars.ticketResult' }]}
          stepId="step-pick-fields"
        />
      );
    });

    const listEditor = screen.getByPlaceholderText(
      'Enter one value per line, or comma-separated'
    ) as HTMLTextAreaElement;

    expect(listEditor).toBeInTheDocument();
    expect(listEditor.value).toContain('ticket_id');
    expect(listEditor.value).toContain('updated');
    expect(
      screen.getByTestId('mapping-step-pick-fields-fields-source-mode')
    ).toHaveValue('fixed');
    expect(
      document.getElementById('mapping-step-pick-fields-fields-literal-json')
    ).not.toBeInTheDocument();
  });

  it('T278: coalesce-value supports multiple structured reference candidates without raw JSON editing', async () => {
    await act(async () => {
      render(
        <TransformEditorHarness
          initialValue={{
            candidates: [
              { $expr: 'payload.ticket.id' },
              { $expr: 'payload.ticket.summary' },
            ],
          }}
          targetFields={[
            {
              name: 'candidates',
              type: 'array',
              constraints: {
                itemType: 'unknown',
              },
            },
          ]}
          fieldOptions={[
            { value: 'payload.ticket.id', label: 'payload.ticket.id' },
            { value: 'payload.ticket.summary', label: 'payload.ticket.summary' },
          ]}
          stepId="step-coalesce"
        />
      );
    });

    expect(
      screen.getByTestId('mapping-step-coalesce-candidates[0]-source-mode')
    ).toHaveValue('reference');
    expect(screen.getByTestId('mapping-step-coalesce-candidates[0]-reference-field')).toBeInTheDocument();
    expect(
      screen.getByTestId('mapping-step-coalesce-candidates[1]-source-mode')
    ).toHaveValue('reference');
    expect(screen.getByTestId('mapping-step-coalesce-candidates[1]-reference-field')).toBeInTheDocument();
    expect(screen.getByTestId('mapping-step-coalesce-candidates[0]-reference-field')).toHaveValue('payload.ticket.id');
    expect(screen.getByTestId('mapping-step-coalesce-candidates[1]-reference-field')).toHaveValue('payload.ticket.summary');
    expect(
      document.getElementById('mapping-step-coalesce-candidates-literal-json')
    ).not.toBeInTheDocument();
  });

  it('T279: build-array supports multiple structured references without raw JSON editing', async () => {
    await act(async () => {
      render(
        <TransformEditorHarness
          initialValue={{
            items: [
              { $expr: 'payload.ticket.id' },
              { $expr: 'vars.ticketResult.updated' },
            ],
          }}
          targetFields={[
            {
              name: 'items',
              type: 'array',
              constraints: {
                itemType: 'unknown',
              },
            },
          ]}
          fieldOptions={[
            { value: 'payload.ticket.id', label: 'payload.ticket.id' },
            { value: 'vars.ticketResult.updated', label: 'vars.ticketResult.updated' },
          ]}
          stepId="step-build-array"
        />
      );
    });

    expect(screen.getByTestId('mapping-step-build-array-items[0]-source-mode')).toHaveValue(
      'reference'
    );
    expect(screen.getByTestId('mapping-step-build-array-items[1]-source-mode')).toHaveValue(
      'reference'
    );
    expect(screen.getByTestId('mapping-step-build-array-items[0]-reference-field')).toBeInTheDocument();
    expect(screen.getByTestId('mapping-step-build-array-items[1]-reference-field')).toBeInTheDocument();
    expect(screen.getByTestId('mapping-step-build-array-items[0]-reference-field')).toHaveValue('payload.ticket.id');
    expect(screen.getByTestId('mapping-step-build-array-items[1]-reference-field')).toHaveValue(
      'vars.ticketResult.updated'
    );
    expect(
      document.getElementById('mapping-step-build-array-items-literal-json')
    ).not.toBeInTheDocument();
  });
});
