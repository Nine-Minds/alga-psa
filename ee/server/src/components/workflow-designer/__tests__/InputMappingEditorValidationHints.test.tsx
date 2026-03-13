/** @vitest-environment jsdom */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
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

describe('InputMappingEditor validation hints', () => {
  it('T117: renders inline incompatibility messaging for incompatible references', async () => {
    render(
      <InputMappingEditor
        value={{ summary: { $expr: 'payload.ticket' } }}
        onChange={vi.fn()}
        targetFields={[
          {
            name: 'summary',
            type: 'string',
            required: true,
          },
        ]}
        fieldOptions={[
          { value: 'payload.ticket', label: 'Payload ticket' },
        ]}
        stepId="step-1"
        positionsHandlers={positionsHandlers}
        sourceTypeMap={new Map([['payload.ticket', 'object']])}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('Type "object" is incompatible with expected "string"')).toBeInTheDocument();
    });

    expect(screen.getByText('Type "object" is incompatible with expected "string"')).toBeInTheDocument();
  });
});
