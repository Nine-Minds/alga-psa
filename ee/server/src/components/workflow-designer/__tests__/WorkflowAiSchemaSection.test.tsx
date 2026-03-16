// @vitest-environment jsdom

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { WorkflowAiSchemaSection } from '../WorkflowAiSchemaSection';

describe('WorkflowAiSchemaSection', () => {
  it('keeps a newly added simple-mode field visible when the parent rehydrates from the emitted schema', () => {
    const ControlledHarness = () => {
      const [config, setConfig] = React.useState({
        actionId: 'ai.infer',
        aiOutputSchemaMode: 'simple' as const,
        aiOutputSchema: {
          type: 'object',
          properties: {},
          additionalProperties: false,
        },
      });

      return (
        <WorkflowAiSchemaSection
          stepId="step-controlled"
          config={config}
          onChange={(patch) => setConfig((current) => ({ ...current, ...patch }))}
        />
      );
    };

    const { container } = render(<ControlledHarness />);

    fireEvent.click(screen.getByRole('button', { name: /add field/i }));

    expect(container.querySelector('input[id*="-ai-field-name-"]')).toBeTruthy();
  });

  it('T008/T010: simple mode persists inline schema config as fields are added and removed', () => {
    const onChange = vi.fn();

    render(
      <WorkflowAiSchemaSection
        stepId="step-1"
        config={{
          actionId: 'ai.infer',
          aiOutputSchemaMode: 'simple',
          aiOutputSchema: {
            type: 'object',
            properties: {},
            additionalProperties: false,
          },
        }}
        onChange={onChange}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /add field/i }));
    fireEvent.change(screen.getAllByRole('textbox')[0], { target: { value: 'summary' } });
    fireEvent.click(screen.getByLabelText('Required'));
    fireEvent.change(screen.getAllByRole('textbox')[1], { target: { value: 'Short summary' } });

    expect(onChange).toHaveBeenLastCalledWith({
      aiOutputSchemaMode: 'simple',
      aiOutputSchema: {
        type: 'object',
        properties: {
          summary: {
            type: 'string',
            description: 'Short summary',
          },
        },
        additionalProperties: false,
        required: ['summary'],
      },
      aiOutputSchemaText: undefined,
    });

    fireEvent.click(screen.getByRole('button', { name: /remove/i }));
    expect(onChange).toHaveBeenLastCalledWith({
      aiOutputSchemaMode: 'simple',
      aiOutputSchema: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
      aiOutputSchemaText: undefined,
    });
  });

  it('T018/T019: advanced mode edits raw inline JSON Schema and surfaces validation feedback', () => {
    const onChange = vi.fn();

    render(
      <WorkflowAiSchemaSection
        stepId="step-2"
        config={{
          actionId: 'ai.infer',
          aiOutputSchemaMode: 'advanced',
          aiOutputSchemaText: '{ "type": "object", "properties": {} }',
        }}
        onChange={onChange}
      />
    );

    fireEvent.change(screen.getByRole('textbox'), { target: { value: '{' } });
    expect(screen.getByText(/schema validation/i)).toBeInTheDocument();
    expect(onChange).toHaveBeenLastCalledWith({
      aiOutputSchemaMode: 'advanced',
      aiOutputSchemaText: '{',
      aiOutputSchema: undefined,
    });

    fireEvent.change(screen.getByRole('textbox'), {
      target: {
        value: JSON.stringify({
          type: 'object',
          properties: {
            category: { type: 'string' },
          },
          required: ['category'],
        }, null, 2),
      },
    });

    expect(onChange).toHaveBeenLastCalledWith({
      aiOutputSchemaMode: 'advanced',
      aiOutputSchemaText: JSON.stringify({
        type: 'object',
        properties: {
          category: { type: 'string' },
        },
        required: ['category'],
      }, null, 2),
      aiOutputSchema: {
        type: 'object',
        properties: {
          category: { type: 'string' },
        },
        required: ['category'],
      },
    });
  });

  it('T021: advanced-only saved schemas reopen in advanced mode with an explicit fallback message', () => {
    render(
      <WorkflowAiSchemaSection
        stepId="step-3"
        config={{
          actionId: 'ai.infer',
          aiOutputSchemaMode: 'simple',
          aiOutputSchema: {
            type: 'object',
            properties: {
              result: {
                type: 'object',
                additionalProperties: { type: 'string' },
              },
            },
          },
        }}
        onChange={() => undefined}
      />
    );

    expect(screen.getByText(/advanced json schema features/i)).toBeInTheDocument();
    expect(screen.getByRole('textbox')).toBeInTheDocument();
  });
});
