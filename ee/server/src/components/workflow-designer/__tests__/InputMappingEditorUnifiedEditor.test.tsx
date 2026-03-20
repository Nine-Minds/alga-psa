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

vi.mock('@alga-psa/ui/components/Dialog', () => ({
  Dialog: ({
    isOpen,
    children,
  }: {
    isOpen: boolean;
    children: React.ReactNode;
  }) => (isOpen ? <div data-testid="workflow-editor-dialog">{children}</div> : null),
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
      document.getElementById('mapping-step-unified-editor-subject-literal-str')?.tagName
    ).toBe('INPUT');
    expect(screen.queryByRole('button', { name: /open editor/i })).not.toBeInTheDocument();
  });

  it('T005: renders a dialog affordance when a field is configured with a dialog-only editor surface', async () => {
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

    expect(
      document.getElementById('mapping-step-unified-editor-notes-literal-str')
    ).toBeNull();
    expect(screen.getByRole('button', { name: /open editor/i })).toBeInTheDocument();
  });

  it('T006: prompt fields render an inline multiline editor plus a dialog-launch control from unified editor metadata', async () => {
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

    expect(
      document.getElementById('mapping-step-unified-editor-prompt-literal-str')?.tagName
    ).toBe('TEXTAREA');
    expect(screen.getByRole('button', { name: /open editor/i })).toBeInTheDocument();
  });

  it('T007/T010: prompt dialog editing starts from the current value and writes changes back to the fixed mapping', async () => {
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

    fireEvent.click(screen.getByRole('button', { name: /open editor/i }));

    const dialogTextArea = document.getElementById(
      'mapping-step-unified-editor-prompt-dialog-textarea'
    ) as HTMLTextAreaElement | null;

    expect(dialogTextArea?.value).toBe('Initial prompt');

    fireEvent.change(dialogTextArea as HTMLTextAreaElement, {
      target: { value: 'Updated prompt body' },
    });
    fireEvent.click(screen.getByRole('button', { name: /apply/i }));

    await waitFor(() => {
      expect(screen.getByTestId('mapping-value').textContent).toContain('Updated prompt body');
    });

    expect(
      (document.getElementById('mapping-step-unified-editor-prompt-literal-str') as HTMLTextAreaElement)
        .value
    ).toBe('Updated prompt body');
  });

  it('T009: fixed and reference source-mode switching continues to preserve unified editor-backed fixed values', async () => {
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

    fireEvent.change(screen.getByTestId('mapping-step-unified-editor-prompt-source-mode'), {
      target: { value: 'reference' },
    });
    fireEvent.change(screen.getByTestId('mapping-step-unified-editor-prompt-source-mode'), {
      target: { value: 'fixed' },
    });

    await waitFor(() => {
      expect(
        (document.getElementById('mapping-step-unified-editor-prompt-literal-str') as HTMLTextAreaElement)
          .value
      ).toBe('Preserved prompt value');
    });
  });
});
