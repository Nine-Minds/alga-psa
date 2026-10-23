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

vi.mock('@alga-psa/ui/components/SearchableSelect', () => import('./mocks/searchableSelectMock'));

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

vi.mock('@alga-psa/ui/components/Dialog', () => ({
  Dialog: ({
    isOpen,
    children,
    footer,
  }: {
    isOpen: boolean;
    children: React.ReactNode;
    footer?: React.ReactNode;
  }) => (isOpen ? (
    <div data-testid="workflow-editor-dialog">
      {children}
      {footer}
    </div>
  ) : null),
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
  DialogDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
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

const UnifiedEditorHarness = ({
  initialValue,
  targetFields,
  stepId = 'step-unified-editor',
}: {
  initialValue: InputMapping;
  targetFields: React.ComponentProps<typeof InputMappingEditor>['targetFields'];
  stepId?: string;
}) => {
  const [value, setValue] = React.useState<InputMapping>(initialValue);

  return (
    <>
      <InputMappingEditor
        value={value}
        onChange={setValue}
        targetFields={targetFields}
        fieldOptions={[]}
        stepId={stepId}
        positionsHandlers={positionsHandlers}
      />
      <pre data-testid="mapping-value">{JSON.stringify(value)}</pre>
    </>
  );
};

describe('InputMappingEditor unified fixed-value editors', () => {
  it('T004: renders the inline editor configured by a unified text editor surface', async () => {
    await act(async () => {
      render(
        <UnifiedEditorHarness
          initialValue={{ subject: 'Short subject' }}
          targetFields={[
            {
              name: 'subject',
              type: 'string',
              editor: {
                kind: 'text',
                inline: { mode: 'input' },
              },
            },
          ]}
        />
      );
    });

    expect(
      document.getElementById('mapping-step-unified-editor-subject-literal-str')?.getAttribute('rows')
    ).toBe('1');
    expect(screen.queryByRole('button', { name: /open editor/i })).not.toBeInTheDocument();
  });

  it('T005: a large-text field is free text: the multi-line Text editor with Insert field and Expand', async () => {
    await act(async () => {
      render(
        <UnifiedEditorHarness
          initialValue={{ notes: 'Longer notes' }}
          targetFields={[
            {
              name: 'notes',
              type: 'string',
              editor: {
                kind: 'text',
                dialog: { mode: 'large-text' },
              },
            },
          ]}
        />
      );
    });

    expect(document.getElementById('mapping-step-unified-editor-notes-literal-str')?.tagName).toBe('TEXTAREA');
    expect(document.getElementById('mapping-step-unified-editor-notes-text-template')).toBeInTheDocument();
    expect(document.getElementById('mapping-step-unified-editor-notes-text-template-expand')).toBeInTheDocument();
  });

  it('T006: prompt fields get the multi-line Text editor rather than a plain box', async () => {
    await act(async () => {
      render(
        <UnifiedEditorHarness
          initialValue={{ prompt: 'Line 1\nLine 2' }}
          targetFields={[
            {
              name: 'prompt',
              type: 'string',
              editor: {
                kind: 'text',
                inline: { mode: 'textarea' },
                dialog: { mode: 'large-text' },
              },
            },
          ]}
        />
      );
    });

    const textArea = document.getElementById('mapping-step-unified-editor-prompt-literal-str') as HTMLTextAreaElement;
    expect(textArea.tagName).toBe('TEXTAREA');
    expect(textArea.value).toBe('Line 1\nLine 2');
    expect(screen.queryByRole('button', { name: /open editor/i })).not.toBeInTheDocument();
  });

  it('T007/T010: the expanded editor starts from the current value and writes changes back to the fixed mapping', async () => {
    await act(async () => {
      render(
        <UnifiedEditorHarness
          initialValue={{ prompt: 'Initial prompt' }}
          targetFields={[
            {
              name: 'prompt',
              type: 'string',
              editor: {
                kind: 'text',
                inline: { mode: 'textarea' },
                dialog: { mode: 'large-text' },
              },
            },
          ]}
        />
      );
    });

    fireEvent.click(document.getElementById('mapping-step-unified-editor-prompt-text-template-expand') as HTMLElement);

    const expanded = document.getElementById(
      'mapping-step-unified-editor-prompt-text-template-expanded'
    ) as HTMLTextAreaElement | null;
    expect(expanded?.value).toBe('Initial prompt');
    // The expanded editor keeps Insert field.
    expect(screen.getByTestId('mapping-step-unified-editor-prompt-text-template-expanded-insert-field')).toBeInTheDocument();

    fireEvent.change(expanded as HTMLTextAreaElement, { target: { value: 'Updated prompt body' } });
    fireEvent.click(screen.getByRole('button', { name: /done/i }));

    await waitFor(() => {
      expect(screen.getByTestId('mapping-value').textContent).toContain('Updated prompt body');
    });
    expect(
      (document.getElementById('mapping-step-unified-editor-prompt-literal-str') as HTMLTextAreaElement).value
    ).toBe('Updated prompt body');
  });

  it('T009: switching the value source away and back continues to preserve unified editor-backed fixed values', async () => {
    await act(async () => {
      render(
        <UnifiedEditorHarness
          initialValue={{ prompt: 'Preserved prompt value' }}
          targetFields={[
            {
              name: 'prompt',
              type: 'string',
              editor: {
                kind: 'text',
                inline: { mode: 'textarea' },
                dialog: { mode: 'large-text' },
              },
            },
          ]}
        />
      );
    });

    fireEvent.change(screen.getByTestId('mapping-step-unified-editor-prompt-value-source'), {
      target: { value: '__workflow-value-source:expression' },
    });
    fireEvent.change(screen.getByTestId('mapping-step-unified-editor-prompt-value-source'), {
      target: { value: '__workflow-value-source:fixed' },
    });

    await waitFor(() => {
      expect(
        (document.getElementById('mapping-step-unified-editor-prompt-literal-str') as HTMLTextAreaElement)
          .value
      ).toBe('Preserved prompt value');
    });
  });
});
