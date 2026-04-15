// @vitest-environment jsdom

import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ComposeTextOutput } from '@alga-psa/workflows/authoring';
import type { DataContext } from '../workflowDataContext';

const clipboardWriteTextMock = vi.fn();

vi.mock('@alga-psa/ui/components/Button', () => ({
  Button: ({ children, ...props }: any) => <button {...props}>{children}</button>,
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
        <option key={option.value} value={option.value} disabled={option.is_inactive}>
          {option.label}
        </option>
      ))}
    </select>
  ),
}));

vi.mock('@alga-psa/ui/components/Input', () => ({
  Input: ({ id, label, ...props }: any) => (
    <label htmlFor={id}>
      <span>{label}</span>
      <input id={id} {...props} />
    </label>
  ),
}));

vi.mock('@alga-psa/ui/components/Card', () => ({
  Card: ({ children }: any) => <div>{children}</div>,
}));

vi.mock('../WorkflowComposeTextDocumentEditor', async () => {
  const ReactModule = await import('react');

  return {
    WorkflowComposeTextDocumentEditor: ReactModule.forwardRef(({ value, onChange }: any, ref) => {
      ReactModule.useImperativeHandle(ref, () => ({
        insertReference: ({ path, label }: { path: string; label: string }) => {
          const currentParagraph = value.blocks[0]?.type === 'paragraph'
            ? value.blocks[0]
            : { type: 'paragraph', children: [] };

          onChange({
            version: 1,
            blocks: [{
              type: 'paragraph',
              children: [
                ...(currentParagraph.children ?? []),
                { type: 'reference', path, label },
              ],
            }],
          });
          return true;
        },
      }));

      const references = value.blocks.flatMap((block: any) =>
        'children' in block
          ? (block.children ?? []).filter((child: any) => child.type === 'reference')
          : []
      );

      return (
        <div data-testid="compose-document-editor">
          {references.map((reference: any, index: number) => (
            <button
              key={`${reference.path}-${index}`}
              type="button"
              data-compose-text-reference-chip={reference.path}
              aria-label={`Remove reference ${reference.label}`}
              onClick={() => {
                onChange({
                  version: 1,
                  blocks: value.blocks.flatMap((block: any) => {
                    if (!('children' in block)) {
                      return [block];
                    }

                    const nextChildren = (block.children ?? []).filter((child: any) => child.path !== reference.path);
                    if (nextChildren.length === 0) {
                      return [];
                    }

                    return [{
                      ...block,
                      children: nextChildren,
                    }];
                  }),
                });
              }}
            >
              {reference.label}
            </button>
          ))}
        </div>
      );
    }),
  };
});

import { WorkflowComposeTextSection } from '../WorkflowComposeTextSection';

const baseDataContext: DataContext = {
  payload: [
    {
      name: 'ticket',
      type: 'object',
      required: true,
      nullable: false,
      children: [
        {
          name: 'id',
          type: 'string',
          required: true,
          nullable: false,
        },
      ],
    },
  ],
  payloadSchema: {
    type: 'object',
    properties: {
      ticket: {
        type: 'object',
        properties: {
          id: { type: 'string' },
        },
      },
    },
  },
  steps: [
    {
      stepId: 'step-upstream',
      stepName: 'Ticket Result',
      saveAs: 'ticketResult',
      outputSchema: {
        type: 'object',
        properties: {
          subject: { type: 'string' },
        },
      },
      fields: [
        {
          name: 'subject',
          type: 'string',
          required: true,
          nullable: false,
        },
      ],
    },
  ],
  globals: {
    env: [],
    secrets: [],
    meta: [],
    error: [],
  },
};

const baseOutputs: ComposeTextOutput[] = [
  {
    id: 'output-1',
    label: 'Text',
    stableKey: 'text',
    document: { version: 1, blocks: [] },
  },
  {
    id: 'output-2',
    label: 'Email Body',
    stableKey: 'email_body',
    document: { version: 1, blocks: [] },
  },
];

const Harness: React.FC<{
  initialOutputs?: ComposeTextOutput[];
  onOutputsChange?: (outputs: ComposeTextOutput[]) => void;
}> = ({ initialOutputs = baseOutputs, onOutputsChange }) => {
  const [config, setConfig] = React.useState<Record<string, unknown>>({
    actionId: 'transform.compose_text',
    version: 1,
    outputs: initialOutputs,
  });

  return (
    <WorkflowComposeTextSection
      stepId="step-1"
      config={config}
      saveAs="composed"
      dataContext={baseDataContext}
      onChange={(patch) => {
        const nextOutputs = patch.outputs as ComposeTextOutput[];
        setConfig((current) => ({ ...current, ...patch }));
        onOutputsChange?.(nextOutputs);
      }}
    />
  );
};

describe('WorkflowComposeTextSection', () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    clipboardWriteTextMock.mockReset();
    Object.assign(navigator, {
      clipboard: {
        writeText: clipboardWriteTextMock,
      },
    });
  });

  it('T027/T028: renders the output list, supports selection, and adds outputs with generated stable keys', async () => {
    render(<Harness />);

    expect(screen.getByText('Text')).toBeInTheDocument();
    expect(screen.getByText('Email Body')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Email Body email_body/i }));
    expect(screen.getByDisplayValue('Email Body')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /add output/i }));

    await waitFor(() => {
      expect(screen.getByDisplayValue('Output 3')).toBeInTheDocument();
    });
    expect(screen.getByDisplayValue('output_3')).toBeInTheDocument();
  });

  it('T029/T030/T036: preserves stable keys across reordering and label edits, copies the reference path, and surfaces invalid manual key edits', async () => {
    render(<Harness />);

    fireEvent.click(screen.getByRole('button', { name: /Email Body email_body/i }));
    fireEvent.change(screen.getByDisplayValue('Email Body'), { target: { value: 'Follow-up Email' } });
    expect(screen.getByDisplayValue('email_body')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /move follow-up email up/i }));

    const outputButtons = screen.getAllByRole('button').filter((button) => (
      button.textContent?.includes('Follow-up Email') && button.textContent.includes('email_body')
    ));
    expect(outputButtons[0]).toHaveTextContent('email_body');

    fireEvent.click(screen.getByRole('button', { name: /copy path/i }));
    expect(clipboardWriteTextMock).toHaveBeenCalledWith('vars.composed.email_body');

    fireEvent.change(screen.getByDisplayValue('email_body'), { target: { value: 'Bad Key!' } });
    await waitFor(() => {
      expect(screen.getAllByText('Stable keys must be lowercase snake_case identifiers.').length).toBeGreaterThan(0);
    });
  });

  it('creates a generic default output when compose-text starts without outputs', async () => {
    render(<Harness initialOutputs={[]} />);

    await waitFor(() => {
      expect(screen.getByDisplayValue('Text')).toBeInTheDocument();
    });
    expect(screen.getByDisplayValue('text')).toBeInTheDocument();
  });

  it('T031/T032: inserts reference chips from the standard workflow reference picker and removing them updates the serialized document', async () => {
    const onOutputsChange = vi.fn();
    render(<Harness onOutputsChange={onOutputsChange} />);

    fireEvent.click(screen.getByRole('button', { name: /insert reference/i }));

    expect(screen.queryByText('Workflow source browser')).not.toBeInTheDocument();

    fireEvent.change(screen.getByTestId('step-1-compose-text-reference-scope'), {
      target: { value: 'payload' },
    });
    fireEvent.change(screen.getByTestId('step-1-compose-text-reference-field'), {
      target: { value: 'payload.ticket.id' },
    });

    expect(screen.getByText('id')).toBeInTheDocument();

    await waitFor(() => {
      const latestOutputs = onOutputsChange.mock.lastCall?.[0] as ComposeTextOutput[];
      expect(latestOutputs?.[0]?.document.blocks[0]).toEqual({
        type: 'paragraph',
        children: [{ type: 'reference', path: 'payload.ticket.id', label: 'id' }],
      });
    });

    fireEvent.click(screen.getByRole('button', { name: /insert reference/i }));
    fireEvent.change(screen.getByTestId('step-1-compose-text-reference-scope'), {
      target: { value: 'vars' },
    });
    fireEvent.change(screen.getByTestId('step-1-compose-text-reference-step'), {
      target: { value: 'ticketResult' },
    });
    fireEvent.change(screen.getByTestId('step-1-compose-text-reference-field'), {
      target: { value: 'vars.ticketResult.subject' },
    });

    expect(screen.getByText('subject')).toBeInTheDocument();

    await waitFor(() => {
      const latestOutputs = onOutputsChange.mock.lastCall?.[0] as ComposeTextOutput[];
      expect(latestOutputs?.[0]?.document.blocks[0]).toEqual({
        type: 'paragraph',
        children: [
          { type: 'reference', path: 'payload.ticket.id', label: 'id' },
          { type: 'reference', path: 'vars.ticketResult.subject', label: 'subject' },
        ],
      });
    });

    fireEvent.click(screen.getByRole('button', { name: /remove reference id/i }));

    await waitFor(() => {
      const latestOutputs = onOutputsChange.mock.lastCall?.[0] as ComposeTextOutput[];
      expect(latestOutputs?.[0]?.document.blocks[0]).toEqual({
        type: 'paragraph',
        children: [{ type: 'reference', path: 'vars.ticketResult.subject', label: 'subject' }],
      });
    });
  });

  it('T033/T034/T035: hides media affordances and shows duplicate label and stable-key validation inline', async () => {
    render(
      <Harness
        initialOutputs={[
          {
            id: 'dup-1',
            label: 'Prompt',
            stableKey: 'prompt',
            document: { version: 1, blocks: [] },
          },
          {
            id: 'dup-2',
            label: 'prompt',
            stableKey: 'prompt',
            document: { version: 1, blocks: [] },
          },
        ]}
      />
    );

    expect(screen.queryByText(/image/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/attachment/i)).not.toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getAllByText('Output labels must be unique within the step.').length).toBeGreaterThan(0);
      expect(screen.getAllByText('Stable keys must be unique within the step.').length).toBeGreaterThan(0);
    });
  });
});
