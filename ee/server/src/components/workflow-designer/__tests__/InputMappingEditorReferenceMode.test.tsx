/** @vitest-environment jsdom */

import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@alga-psa/tenancy/actions', () => ({
  listTenantSecrets: vi.fn().mockResolvedValue([]),
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

vi.mock('../expression-editor', () => ({
  ExpressionEditor: React.forwardRef(function MockExpressionEditor(
    props: Record<string, never>,
    ref: React.ForwardedRef<HTMLTextAreaElement>
  ) {
    void props;
    return <textarea ref={ref} data-testid="mock-expression-editor" />;
  }),
}));

import { InputMappingEditor } from '../mapping/InputMappingEditor';
import type { MappingPositionsHandlers } from '../mapping/useMappingPositions';

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

describe('InputMappingEditor reference mode', () => {
  it('replaces the whole expression with a direct field reference when a structured source is chosen', () => {
    const onChange = vi.fn();

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
      />
    );

    fireEvent.change(screen.getByTestId('mapping-step-1-summary-picker'), {
      target: { value: 'payload.ticket.id' },
    });

    expect(onChange).toHaveBeenCalledWith({
      summary: { $expr: 'payload.ticket.id' },
    });
  });
});
