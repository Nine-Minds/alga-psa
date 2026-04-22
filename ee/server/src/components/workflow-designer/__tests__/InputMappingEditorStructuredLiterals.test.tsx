/** @vitest-environment jsdom */

import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { InputMappingEditor } from '../mapping/InputMappingEditor';
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

afterEach(() => {
  cleanup();
});

describe('InputMappingEditor structured literals', () => {
  it('T124: nested object fields can use source modes independently from their parent object field', () => {
    render(
      <InputMappingEditor
        value={{
          requester: {
            name: { $expr: 'payload.contact.name' },
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
        fieldOptions={[
          { value: 'payload.contact.name', label: 'Payload contact name' },
        ]}
        stepId="step-nested-modes"
        positionsHandlers={positionsHandlers}
      />
    );

    expect(
      document.getElementById('mapping-step-nested-modes-requester.name-source-mode-container')
    ).toBeInTheDocument();
    expect(
      document.getElementById('mapping-step-nested-modes-requester.email-source-mode-container')
    ).toBeInTheDocument();
    expect(screen.getByDisplayValue('alex@example.com')).toBeInTheDocument();
  });

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

  it('T138: primitive array editors preserve in-progress spaces while typing multi-word values', () => {
    const Harness = () => {
      const [value, setValue] = React.useState<{ tags: string[] }>({ tags: [] });

      return (
        <>
          <InputMappingEditor
            value={value}
            onChange={(nextValue) => setValue(nextValue as typeof value)}
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
            stepId="step-primitive-array-spaces"
            positionsHandlers={positionsHandlers}
          />
          <div data-testid="saved-tags">{JSON.stringify(value.tags)}</div>
        </>
      );
    };

    render(<Harness />);

    const listEditor = screen.getByPlaceholderText(
      'Enter one value per line, or comma-separated'
    ) as HTMLTextAreaElement;

    fireEvent.focus(listEditor);
    fireEvent.change(listEditor, { target: { value: 'Managed ' } });
    expect(listEditor.value).toBe('Managed ');

    fireEvent.change(listEditor, { target: { value: 'Managed Services' } });
    expect(listEditor.value).toBe('Managed Services');
    expect(screen.getByTestId('saved-tags').textContent).toBe('["Managed Services"]');
  });

  it('T129/T130/T131/T132: fixed mode uses structured enum, boolean, number, and string controls', () => {
    render(
      <InputMappingEditor
        value={{
          status: 'open',
          enabled: true,
          attempts: 3,
          summary: 'Printer offline',
        }}
        onChange={vi.fn()}
        targetFields={[
          {
            name: 'status',
            type: 'string',
            enum: ['open', 'closed'],
          },
          {
            name: 'enabled',
            type: 'boolean',
          },
          {
            name: 'attempts',
            type: 'number',
          },
          {
            name: 'summary',
            type: 'string',
          },
        ]}
        fieldOptions={[]}
        stepId="step-fixed-controls"
        positionsHandlers={positionsHandlers}
      />
    );

    expect(
      document.getElementById('mapping-step-fixed-controls-status-literal-enum-container')
    ).toBeInTheDocument();
    expect(
      document.getElementById('mapping-step-fixed-controls-enabled-literal-bool-container')
    ).toBeInTheDocument();

    const numberInput = document.getElementById(
      'mapping-step-fixed-controls-attempts-literal-num'
    ) as HTMLInputElement | null;
    const stringInput = document.getElementById(
      'mapping-step-fixed-controls-summary-literal-str'
    ) as HTMLInputElement | null;

    expect(numberInput).not.toBeNull();
    expect(numberInput?.type).toBe('number');
    expect(numberInput?.value).toBe('3');

    expect(stringInput).not.toBeNull();
    expect(stringInput?.type).toBe('text');
    expect(stringInput?.value).toBe('Printer offline');
  });

  it('T133: nullable fields expose an intentional null state in fixed mode', () => {
    render(
      <InputMappingEditor
        value={{
          due_at: null,
        }}
        onChange={vi.fn()}
        targetFields={[
          {
            name: 'due_at',
            type: 'string',
            nullable: true,
          },
        ]}
        fieldOptions={[]}
        stepId="step-nullable"
        positionsHandlers={positionsHandlers}
      />
    );

    expect(
      document.getElementById('mapping-step-nullable-due_at-literal-null-mode-container')
    ).toBeInTheDocument();
    expect(
      document.getElementById('mapping-step-nullable-due_at-literal-str')
    ).not.toBeInTheDocument();
  });

  it('T136: resetting a nested object group clears authored child values safely', () => {
    const Harness = () => {
      const [value, setValue] = React.useState({
        requester: {
          name: 'Alex',
          email: 'alex@example.com',
        },
      });

      return (
        <InputMappingEditor
          value={value}
          onChange={(nextValue) => setValue(nextValue as typeof value)}
          targetFields={[
            {
              name: 'requester',
              type: 'object',
              children: [
                { name: 'name', type: 'string', required: true },
                { name: 'email', type: 'string' },
              ],
            },
          ]}
          fieldOptions={[]}
          stepId="step-reset"
          positionsHandlers={positionsHandlers}
        />
      );
    };

    render(
      <Harness />
    );

    fireEvent.click(
      document.getElementById('mapping-step-reset-requester-literal-object-reset') as HTMLElement
    );

    const nameInput = document.getElementById(
      'mapping-step-reset-requester.name-literal-str'
    ) as HTMLInputElement | null;
    const emailInput = document.getElementById(
      'mapping-step-reset-requester.email-literal-str'
    ) as HTMLInputElement | null;

    expect(nameInput?.value).toBe('');
    expect(emailInput?.value).toBe('');
    expect(screen.queryByDisplayValue('Alex')).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue('alex@example.com')).not.toBeInTheDocument();
  });

  it('T137: reopening a saved draft rehydrates nested authored values correctly', () => {
    const props = {
      value: {
        requester: {
          name: 'Alex',
          email: 'alex@example.com',
        },
      },
      onChange: vi.fn(),
      targetFields: [
        {
          name: 'requester',
          type: 'object',
          children: [
            { name: 'name', type: 'string', required: true },
            { name: 'email', type: 'string' },
          ],
        },
      ],
      fieldOptions: [],
      stepId: 'step-rehydrate',
      positionsHandlers,
    };

    const view = render(<InputMappingEditor {...props} />);
    expect(screen.getByDisplayValue('Alex')).toBeInTheDocument();

    view.unmount();
    render(<InputMappingEditor {...props} />);

    expect(screen.getByDisplayValue('Alex')).toBeInTheDocument();
    expect(screen.getByDisplayValue('alex@example.com')).toBeInTheDocument();
  });
});
