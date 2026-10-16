/** @vitest-environment jsdom */

import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
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

vi.mock('@alga-psa/ui/components/SearchableSelect', () => ({
  __esModule: true,
  default: ({
    id,
    options,
    value,
    onChange,
  }: {
    id?: string;
    options: Array<{ value: string; label: string }>;
    value?: string;
    onChange: (value: string) => void;
  }) => (
    <select data-testid={id} value={value ?? ''} onChange={(event) => onChange(event.target.value)}>
      <option value="">--</option>
      {options.map((option) => (
        <option key={option.value} value={option.value}>{option.label}</option>
      ))}
    </select>
  ),
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
    options: Array<{ value: string; label: string; is_inactive?: boolean }>;
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
        <option
          key={option.value}
          value={option.value}
          disabled={option.is_inactive}
        >
          {option.label}
        </option>
      ))}
    </select>
  ),
}));

import { InputMappingEditor } from '../mapping/InputMappingEditor';
import type { MappingPositionsHandlers } from '../mapping/useMappingPositions';
import type { DataTreeContext } from '../mapping/SourceDataTree';
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

const referenceBrowseContext: DataTreeContext = {
  payload: [
    {
      name: 'ticket',
      path: 'payload.ticket',
      type: 'object',
      source: 'payload',
      children: [
        {
          name: 'id',
          path: 'payload.ticket.id',
          type: 'string',
          source: 'payload',
        },
      ],
    },
  ],
  vars: [
    {
      stepId: 'step-0',
      stepName: 'Find Ticket',
      saveAs: 'ticketResult',
      fields: [
        {
          name: 'ticket_id',
          path: 'vars.ticketResult.ticket_id',
          type: 'string',
          source: 'vars',
        },
        {
          name: 'ticket_count',
          path: 'vars.ticketResult.ticket_count',
          type: 'number',
          source: 'vars',
        },
      ],
    },
  ],
  meta: [
    {
      name: 'traceId',
      path: 'meta.traceId',
      type: 'string',
      source: 'meta',
    },
  ],
  error: [],
};

afterEach(() => {
  cleanup();
});

describe('InputMappingEditor reference mode', () => {
  it('T151/T313: replaces the whole expression with a direct field reference when a structured source is chosen through source scope selectors', async () => {
    const onChange = vi.fn();

    await act(async () => {
      render(
        <InputMappingEditor
          value={{ summary: { $expr: 'payload.previous.id' } }}
          onChange={onChange}
          targetFields={[
            {
              name: 'summary',
              type: 'string',
              required: true,
            },
          ]}
          fieldOptions={[
            { value: 'payload.ticket.id', label: 'payload.ticket.id' },
          ]}
          stepId="step-1"
          positionsHandlers={positionsHandlers}
          referenceBrowseContext={referenceBrowseContext}
        />
      );
    });

    // Step-by-step browsing opens on request once a field is chosen.
    await act(async () => {
      fireEvent.click(document.getElementById('mapping-step-1-summary-browse-sources-toggle')!);
    });
    await act(async () => {
      fireEvent.change(screen.getByTestId('mapping-step-1-summary-reference-scope'), {
        target: { value: 'payload' },
      });
      fireEvent.change(screen.getByTestId('mapping-step-1-summary-reference-field'), {
        target: { value: 'payload.ticket.id' },
      });
    });

    expect(onChange).toHaveBeenCalledWith({
      summary: { $expr: 'payload.ticket.id' },
    });
  });

  it('sends a single-value reference picked for a list input as a one-item list', async () => {
    const onChange = vi.fn();
    const targetFields = [
      { name: 'user_ids', type: 'array', required: true, constraints: { itemType: 'string' } },
    ];
    const sourceTypeMap = new Map([['vars.ticketResult.ticket_id', 'string']]);

    const { rerender } = render(
      <InputMappingEditor
        value={{ user_ids: { $expr: '' } }}
        onChange={onChange}
        targetFields={targetFields}
        fieldOptions={[{ value: 'vars.ticketResult.ticket_id', label: 'vars.ticketResult.ticket_id' }]}
        stepId="step-list"
        positionsHandlers={positionsHandlers}
        referenceBrowseContext={referenceBrowseContext}
        sourceTypeMap={sourceTypeMap}
      />
    );

    await act(async () => {
      fireEvent.change(screen.getByTestId('mapping-step-list-user_ids-reference-scope'), { target: { value: 'vars' } });
      fireEvent.change(screen.getByTestId('mapping-step-list-user_ids-reference-step'), { target: { value: 'ticketResult' } });
    });
    // The single-value field is offered for the list input.
    expect(screen.getByTestId('mapping-step-list-user_ids-reference-field')).toHaveTextContent('ticket_id');

    await act(async () => {
      fireEvent.change(screen.getByTestId('mapping-step-list-user_ids-reference-field'), {
        target: { value: 'vars.ticketResult.ticket_id' },
      });
    });
    expect(onChange).toHaveBeenLastCalledWith({ user_ids: { $expr: '[vars.ticketResult.ticket_id]' } });

    rerender(
      <InputMappingEditor
        value={{ user_ids: { $expr: '[vars.ticketResult.ticket_id]' } }}
        onChange={onChange}
        targetFields={targetFields}
        fieldOptions={[{ value: 'vars.ticketResult.ticket_id', label: 'vars.ticketResult.ticket_id' }]}
        stepId="step-list"
        positionsHandlers={positionsHandlers}
        referenceBrowseContext={referenceBrowseContext}
        sourceTypeMap={sourceTypeMap}
      />
    );
    expect(screen.getByTestId('mapping-step-list-user_ids-value-source')).toHaveValue('vars.ticketResult.ticket_id');
    expect(document.getElementById('mapping-step-list-user_ids-one-item-list-note')).toBeInTheDocument();
  });

  it('T157: preserves the current reference expression when unrelated upstream options change', async () => {
    const onChange = vi.fn();
    let rerender: ReturnType<typeof render>['rerender'];

    await act(async () => {
      ({ rerender } = render(
        <InputMappingEditor
          value={{ summary: { $expr: 'vars.ticketResult.ticket_id' } }}
          onChange={onChange}
          targetFields={[
            {
              name: 'summary',
              type: 'string',
              required: true,
            },
          ]}
          fieldOptions={[
            { value: 'vars.ticketResult.ticket_id', label: 'vars.ticketResult.ticket_id' },
          ]}
          stepId="step-1"
          positionsHandlers={positionsHandlers}
          referenceBrowseContext={referenceBrowseContext}
        />
      ));
    });

    expect(screen.queryByTestId('mapping-step-1-summary-reference-scope')).not.toBeInTheDocument();
    await act(async () => {
      fireEvent.click(document.getElementById('mapping-step-1-summary-browse-sources-toggle')!);
    });
    expect(screen.getByTestId('mapping-step-1-summary-reference-scope')).toHaveValue('vars');
    expect(screen.getByTestId('mapping-step-1-summary-reference-step')).toHaveValue('ticketResult');
    expect(screen.getByTestId('mapping-step-1-summary-value-source')).toHaveValue(
      'vars.ticketResult.ticket_id'
    );

    await act(async () => {
      rerender(
        <InputMappingEditor
          value={{ summary: { $expr: 'vars.ticketResult.ticket_id' } }}
          onChange={onChange}
          targetFields={[
            {
              name: 'summary',
              type: 'string',
              required: true,
            },
          ]}
          fieldOptions={[
            { value: 'vars.ticketResult.ticket_id', label: 'vars.ticketResult.ticket_id' },
            { value: 'vars.contactResult.email', label: 'vars.contactResult.email' },
          ]}
          stepId="step-1"
          positionsHandlers={positionsHandlers}
          referenceBrowseContext={referenceBrowseContext}
        />
      );
    });

    expect(screen.getByTestId('mapping-step-1-summary-reference-step')).toHaveValue('ticketResult');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('T335: filters staged reference fields to compatible types for the current target field', async () => {
    await act(async () => {
      render(
        <InputMappingEditor
          value={{ summary: { $expr: '' } }}
          onChange={vi.fn()}
          targetFields={[
            {
              name: 'summary',
              type: 'string',
              required: true,
            },
          ]}
          fieldOptions={[
            { value: 'vars.ticketResult.ticket_id', label: 'vars.ticketResult.ticket_id' },
            { value: 'vars.ticketResult.ticket_count', label: 'vars.ticketResult.ticket_count' },
          ]}
          stepId="step-filtered-reference"
          positionsHandlers={positionsHandlers}
          referenceBrowseContext={referenceBrowseContext}
        />
      );
    });

    await act(async () => {
      fireEvent.change(screen.getByTestId('mapping-step-filtered-reference-summary-reference-scope'), {
        target: { value: 'vars' },
      });
      fireEvent.change(screen.getByTestId('mapping-step-filtered-reference-summary-reference-step'), {
        target: { value: 'ticketResult' },
      });
    });

    expect(
      screen.getByTestId('mapping-step-filtered-reference-summary-reference-field')
    ).toHaveTextContent('ticket_id');
    expect(
      screen.getByTestId('mapping-step-filtered-reference-summary-reference-field')
    ).toHaveTextContent('ticket_count');
  });

  it('T336: preserves the chosen source scope while the user is still staging a reference selection', async () => {
    function StatefulReferenceEditor() {
      const [mapping, setMapping] = React.useState<InputMapping>({ summary: { $expr: '' } });

      return (
        <InputMappingEditor
          value={mapping}
          onChange={setMapping}
          targetFields={[
            {
              name: 'summary',
              type: 'string',
              required: true,
            },
          ]}
          fieldOptions={[
            { value: 'payload.ticket.id', label: 'payload.ticket.id' },
            { value: 'meta.traceId', label: 'meta.traceId' },
          ]}
          stepId="step-staged-scope"
          positionsHandlers={positionsHandlers}
          referenceBrowseContext={referenceBrowseContext}
        />
      );
    }

    await act(async () => {
      render(<StatefulReferenceEditor />);
    });

    await act(async () => {
      fireEvent.change(screen.getByTestId('mapping-step-staged-scope-summary-reference-scope'), {
        target: { value: 'payload' },
      });
    });

    expect(
      screen.getByTestId('mapping-step-staged-scope-summary-reference-scope')
    ).toHaveValue('payload');
    expect(
      screen.getByTestId('mapping-step-staged-scope-summary-value-source')
    ).toBeInTheDocument();
  });

  it('T337: derives payload field choices from the current payload schema when the payload scope is selected', async () => {
    await act(async () => {
      render(
        <InputMappingEditor
          value={{ summary: { $expr: '' } }}
          onChange={vi.fn()}
          targetFields={[
            {
              name: 'summary',
              type: 'string',
              required: true,
            },
          ]}
          fieldOptions={[
            { value: 'payload', label: 'payload' },
          ]}
          expressionContext={{
            payloadSchema: {
              type: 'object',
              properties: {
                email: {
                  type: 'object',
                  properties: {
                    subject: { type: 'string' },
                    from: { type: 'string' },
                  },
                },
                ticketCount: { type: 'number' },
              },
            },
          }}
          stepId="step-payload-schema"
          positionsHandlers={positionsHandlers}
          referenceBrowseContext={{
            ...referenceBrowseContext,
            payload: [],
          }}
        />
      );
    });

    await act(async () => {
      fireEvent.change(screen.getByTestId('mapping-step-payload-schema-summary-reference-scope'), {
        target: { value: 'payload' },
      });
    });

    expect(
      screen.getByTestId('mapping-step-payload-schema-summary-reference-field')
    ).toHaveTextContent('payload');
    expect(
      screen.getByTestId('mapping-step-payload-schema-summary-reference-field')
    ).toHaveTextContent('email.subject');
    expect(
      screen.getByTestId('mapping-step-payload-schema-summary-reference-field')
    ).toHaveTextContent('email.from');
    expect(
      screen.getByTestId('mapping-step-payload-schema-summary-reference-field')
    ).toHaveTextContent('ticketCount');
  });

  it('T338: refreshes visible payload field choices when the payload schema changes upstream', async () => {
    const initialExpressionContext = {
      payloadSchema: {
        type: 'object',
        properties: {
          email: {
            type: 'object',
            properties: {
              subject: { type: 'string' },
            },
          },
        },
      },
    };
    const updatedExpressionContext = {
      payloadSchema: {
        type: 'object',
        properties: {
          inbound: {
            type: 'object',
            properties: {
              title: { type: 'string' },
            },
          },
        },
      },
    };

    let rerender: ReturnType<typeof render>['rerender'];

    await act(async () => {
      ({ rerender } = render(
        <InputMappingEditor
          value={{ summary: { $expr: '' } }}
          onChange={vi.fn()}
          targetFields={[
            {
              name: 'summary',
              type: 'string',
              required: true,
            },
          ]}
          fieldOptions={[
            { value: 'payload', label: 'payload' },
          ]}
          expressionContext={initialExpressionContext}
          stepId="step-payload-refresh"
          positionsHandlers={positionsHandlers}
          referenceBrowseContext={{
            ...referenceBrowseContext,
            payload: [],
          }}
        />
      ));
    });

    await act(async () => {
      fireEvent.change(screen.getByTestId('mapping-step-payload-refresh-summary-reference-scope'), {
        target: { value: 'payload' },
      });
    });

    expect(
      screen.getByTestId('mapping-step-payload-refresh-summary-reference-field')
    ).toHaveTextContent('email.subject');

    await act(async () => {
      rerender(
        <InputMappingEditor
          value={{ summary: { $expr: '' } }}
          onChange={vi.fn()}
          targetFields={[
            {
              name: 'summary',
              type: 'string',
              required: true,
            },
          ]}
          fieldOptions={[
            { value: 'payload', label: 'payload' },
          ]}
          expressionContext={updatedExpressionContext}
          stepId="step-payload-refresh"
          positionsHandlers={positionsHandlers}
          referenceBrowseContext={{
            ...referenceBrowseContext,
            payload: [],
          }}
        />
      );
    });

    expect(
      screen.getByTestId('mapping-step-payload-refresh-summary-reference-field')
    ).toHaveTextContent('inbound.title');
    expect(
      screen.getByTestId('mapping-step-payload-refresh-summary-reference-field')
    ).not.toHaveTextContent('email.subject');
  });

  it('T287: preserves and edits compound mappings in Expression mode', async () => {
    const onChange = vi.fn();
    await act(async () => {
      render(
        <InputMappingEditor
          value={{ summary: { $expr: 'len(payload.summary) > 3 ? payload.summary : meta.traceId' } }}
          onChange={onChange}
          targetFields={[
            {
              name: 'summary',
              type: 'string',
              required: true,
            },
          ]}
          fieldOptions={[
            { value: 'payload.summary', label: 'payload.summary' },
            { value: 'meta.traceId', label: 'meta.traceId' },
          ]}
          stepId="step-advanced-expression"
          positionsHandlers={positionsHandlers}
          referenceBrowseContext={referenceBrowseContext}
        />
      );
    });

    const editor = screen.getByRole('textbox');
    expect(editor).toHaveValue('len(payload.summary) > 3 ? payload.summary : meta.traceId');
    fireEvent.change(editor, { target: { value: 'payload.summary & " updated"' } });
    expect(onChange).toHaveBeenCalledWith({ summary: { $expr: 'payload.summary & " updated"' } });
    expect(screen.queryByText('Legacy mapping no longer supported here')).not.toBeInTheDocument();
  });

  it('opens text joined with fields in the text editor and saves edits back as the joined expression', async () => {
    const onChange = vi.fn();
    await act(async () => {
      render(
        <InputMappingEditor
          value={{ summary: { $expr: 'payload.summary & "-" & meta.traceId' } }}
          onChange={onChange}
          targetFields={[{ name: 'summary', type: 'string', required: true }]}
          fieldOptions={[
            { value: 'payload.summary', label: 'payload.summary' },
            { value: 'meta.traceId', label: 'meta.traceId' },
          ]}
          stepId="step-text-fields"
          positionsHandlers={positionsHandlers}
          referenceBrowseContext={referenceBrowseContext}
        />
      );
    });

    const editor = document.getElementById('mapping-step-text-fields-summary-literal-str') as HTMLInputElement;
    expect(editor).toHaveValue('{{payload.summary}}-{{meta.traceId}}');
    fireEvent.change(editor, { target: { value: 'Summary: {{payload.summary}}' } });
    expect(onChange).toHaveBeenLastCalledWith({ summary: { $expr: '"Summary: " & payload.summary' } });
    fireEvent.change(editor, { target: { value: 'No fields here' } });
    expect(onChange).toHaveBeenLastCalledWith({ summary: 'No fields here' });
  });

  it('converts between Text and Expression without losing the value, and lists the loop item in Text mode', async () => {
    const Harness = () => {
      const [value, setValue] = React.useState<Record<string, unknown>>({ body: 'TODO: ' });
      return (
        <InputMappingEditor
          value={value as never}
          onChange={(next) => setValue(next as Record<string, unknown>)}
          targetFields={[{ name: 'body', type: 'string', required: true }]}
          fieldOptions={[
            { value: 'checklistItem', label: '🔄 checklistItem (current item)' },
            { value: 'payload.clientName', label: 'payload.clientName' },
          ]}
          stepId="step-loop-text"
          positionsHandlers={positionsHandlers}
          referenceBrowseContext={{ ...referenceBrowseContext, forEach: { itemVar: 'checklistItem', indexVar: 'index' } }}
        />
      );
    };
    render(<Harness />);

    const textInput = () => document.getElementById('mapping-step-loop-text-body-literal-str') as HTMLInputElement;
    expect(textInput()).toHaveValue('TODO: ');
    // The loop item is insertable, listed first.
    const insertOptions = Array.from(
      (screen.getByTestId('mapping-step-loop-text-body-literal-str-insert-field') as HTMLSelectElement).options
    ).map((option) => option.value).filter(Boolean);
    expect(insertOptions[0]).toBe('checklistItem');

    await act(async () => {
      fireEvent.change(textInput(), { target: { value: 'TODO: {{checklistItem}}' } });
    });
    await act(async () => {
      fireEvent.change(screen.getByTestId('mapping-step-loop-text-body-value-source'), { target: { value: '__workflow-value-source:expression' } });
    });
    expect(screen.getByRole('textbox')).toHaveValue('"TODO: " & checklistItem');

    await act(async () => {
      fireEvent.change(screen.getByTestId('mapping-step-loop-text-body-value-source'), { target: { value: '__workflow-value-source:fixed' } });
    });
    expect(textInput()).toHaveValue('TODO: {{checklistItem}}');
  });

  it('keeps plain text when switching from Text to Expression', async () => {
    const onChange = vi.fn();
    render(
      <InputMappingEditor
        value={{ body: 'TODO: ' }}
        onChange={onChange}
        targetFields={[{ name: 'body', type: 'string', required: true }]}
        fieldOptions={[]}
        stepId="step-plain-text"
        positionsHandlers={positionsHandlers}
        referenceBrowseContext={referenceBrowseContext}
      />
    );
    await act(async () => {
      fireEvent.change(screen.getByTestId('mapping-step-plain-text-body-value-source'), { target: { value: '__workflow-value-source:expression' } });
    });
    expect(onChange).toHaveBeenLastCalledWith({ body: { $expr: '"TODO: "' } });
  });

  it('explains instead of clearing when an expression cannot be shown as text', async () => {
    const onChange = vi.fn();
    render(
      <InputMappingEditor
        value={{ body: { $expr: 'len(payload.items) > 1 ? "many" : "one"' } }}
        onChange={onChange}
        targetFields={[{ name: 'body', type: 'string', required: true }]}
        fieldOptions={[]}
        stepId="step-complex"
        positionsHandlers={positionsHandlers}
        referenceBrowseContext={referenceBrowseContext}
      />
    );
    await act(async () => {
      fireEvent.change(screen.getByTestId('mapping-step-complex-body-value-source'), { target: { value: '__workflow-value-source:fixed' } });
    });
    expect(onChange).not.toHaveBeenCalled();
    expect(document.getElementById('mapping-step-complex-body-mode-notice')).toBeInTheDocument();
  });

  it('offers one searchable chooser with ranked fields and "choose a specific record"', async () => {
    const onChange = vi.fn();
    await act(async () => {
      render(
        <InputMappingEditor
          value={{ contact_id: '' }}
          onChange={onChange}
          targetFields={[{
            name: 'contact_id',
            type: 'string',
            required: true,
            editor: { kind: 'picker', inline: { mode: 'picker-summary' }, picker: { resource: 'contact' } },
          }]}
          fieldOptions={[
            { value: 'payload.actorContactId', label: 'payload.actorContactId' },
            { value: 'payload.assignedByUserId', label: 'payload.assignedByUserId' },
            { value: 'vars.ticketResult.ticket.contact_name_id', label: 'Requester contact (ticket.contact_name_id)' },
          ]}
          sourceTypeMap={new Map([
            ['payload.actorContactId', 'string'],
            ['payload.assignedByUserId', 'string'],
            ['vars.ticketResult.ticket.contact_name_id', 'string'],
          ])}
          sourceKindMap={new Map([
            ['payload.actorContactId', 'contact'],
            ['payload.assignedByUserId', 'user'],
            ['vars.ticketResult.ticket.contact_name_id', 'contact'],
          ])}
          stepId="step-chooser"
          positionsHandlers={positionsHandlers}
          referenceBrowseContext={referenceBrowseContext}
        />
      );
    });

    const chooser = screen.getByTestId('mapping-step-chooser-contact_id-value-source') as HTMLSelectElement;
    // One source control: choosing the source is choosing the mode, so there is no second mode select.
    expect(screen.queryByTestId('mapping-step-chooser-contact_id-source-mode')).not.toBeInTheDocument();
    expect(chooser).toHaveValue('__workflow-value-source:fixed');
    const optionValues = Array.from(chooser.options).map((option) => option.value).filter(Boolean);
    expect(optionValues).toEqual([
      '__workflow-value-source:fixed',
      'vars.ticketResult.ticket.contact_name_id',
      'payload.actorContactId',
      '__workflow-value-source:expression',
    ]);
    expect(Array.from(chooser.options).map((option) => option.textContent)).toContain('Requester contact (ticket.contact_name_id)');

    await act(async () => {
      fireEvent.change(chooser, { target: { value: 'vars.ticketResult.ticket.contact_name_id' } });
    });
    expect(onChange).toHaveBeenLastCalledWith({ contact_id: { $expr: 'vars.ticketResult.ticket.contact_name_id' } });
  });

  it('T334: shows a collapsible browse-sources tree for reference mode and maps the current field when a source is selected', async () => {
    const onChange = vi.fn();

    await act(async () => {
      render(
        <InputMappingEditor
          value={{ summary: { $expr: '' } }}
          onChange={onChange}
          targetFields={[
            {
              name: 'summary',
              type: 'string',
              required: true,
            },
          ]}
          fieldOptions={[
            { value: 'payload.ticket.id', label: 'payload.ticket.id' },
            { value: 'vars.ticketResult.ticket_id', label: 'vars.ticketResult.ticket_id' },
            { value: 'meta.traceId', label: 'meta.traceId' },
          ]}
          stepId="step-browse-sources"
          positionsHandlers={positionsHandlers}
          referenceBrowseContext={referenceBrowseContext}
        />
      );
    });

    expect(document.getElementById('source-data-tree-search')).not.toBeInTheDocument();

    await act(async () => {
      fireEvent.click(
        document.getElementById('mapping-step-browse-sources-summary-browse-sources-toggle')!
      );
    });

    expect(document.getElementById('source-data-tree-search')).toBeInTheDocument();
    expect(screen.getAllByText('Payload')[0]).toBeInTheDocument();
    expect(screen.getAllByText('Step Outputs (vars)')[0]).toBeInTheDocument();
    expect(screen.getAllByText('Workflow Meta')[0]).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByText('ticket_id'));
    });

    expect(onChange).toHaveBeenCalledWith({
      summary: { $expr: 'vars.ticketResult.ticket_id' },
    });
  });

  it('keeps schema order stable after filling a later field', async () => {
    const onChange = vi.fn();

    const { container } = render(
      <InputMappingEditor
        value={{}}
        onChange={onChange}
        targetFields={[
          {
            name: 'client_id',
            type: 'string',
            required: true,
          },
          {
            name: 'contact_id',
            type: 'string',
            required: false,
          },
          {
            name: 'title',
            type: 'string',
            required: true,
          },
        ]}
        fieldOptions={[
          { value: 'payload.client_id', label: 'payload.client_id' },
        ]}
        stepId="step-stable-order"
        positionsHandlers={positionsHandlers}
        referenceBrowseContext={referenceBrowseContext}
      />
    );

    const initialIds = Array.from(
      container.querySelectorAll('[id^="mapping-field-step-stable-order-"]')
    ).map((element) => element.id);

    expect(initialIds).toEqual([
      'mapping-field-step-stable-order-client_id',
      'mapping-field-step-stable-order-contact_id',
      'mapping-field-step-stable-order-title',
    ]);

    await act(async () => {
      fireEvent.click(document.getElementById('add-mapping-step-stable-order-title')!);
    });

    // Text inputs start in the text editor rather than an empty reference.
    expect(onChange).toHaveBeenCalledWith({
      title: '',
    });
  });

  it('fills an input straight from a same-name, type-matched source', async () => {
    const onChange = vi.fn();
    render(
      <InputMappingEditor
        value={{}}
        onChange={onChange}
        targetFields={[
          { name: 'client_id', type: 'string', required: true },
          { name: 'title', type: 'string', required: true },
        ]}
        fieldOptions={[
          { value: 'vars.clientDetails.client.client_id', label: 'client_id' },
          { value: 'payload.occursOn', label: 'occursOn' },
        ]}
        sourceTypeMap={new Map([
          ['vars.clientDetails.client.client_id', 'string'],
          ['payload.occursOn', 'string'],
        ])}
        stepId="step-strong"
        positionsHandlers={positionsHandlers}
        referenceBrowseContext={referenceBrowseContext}
      />
    );

    await act(async () => {
      fireEvent.click(document.getElementById('add-mapping-step-strong-client_id')!);
    });
    expect(onChange).toHaveBeenLastCalledWith({ client_id: { $expr: 'vars.clientDetails.client.client_id' } });

    await act(async () => {
      fireEvent.click(document.getElementById('add-mapping-step-strong-title')!);
    });
    expect(onChange).toHaveBeenLastCalledWith({ title: '' });
  });
});
