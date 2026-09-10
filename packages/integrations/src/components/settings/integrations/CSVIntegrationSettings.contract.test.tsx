/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';

const accountingCapsState = vi.hoisted(() => ({
  current: {
    catalogRead: true,
    connectionsManage: true,
    mappingsManage: true,
    exportsExecute: true,
    remoteMutate: true,
    hasAny: true,
    loaded: true,
  },
}));

vi.mock('./useAccountingCapabilities', () => ({
  useAccountingCapabilities: () => accountingCapsState.current,
}));

vi.mock('@alga-psa/integrations/components/csv/CSVMappingManager', () => ({
  CSVMappingManager: () => <div>CSV Mapping Manager</div>,
}));

describe('CSVIntegrationSettings Accounting Exports link', () => {
  beforeEach(() => {
    accountingCapsState.current = {
      catalogRead: true,
      connectionsManage: true,
      mappingsManage: true,
      exportsExecute: true,
      remoteMutate: true,
      hasAny: true,
      loaded: true,
    };
  });

  afterEach(() => cleanup());

  it('shows the link with exports_execute and hides it without the capability', async () => {
    const { default: CSVIntegrationSettings } = await import('./CSVIntegrationSettings');

    const { rerender } = render(<CSVIntegrationSettings />);
    expect(screen.getByRole('link', { name: 'Open Accounting Exports' })).toHaveAttribute(
      'href',
      '/msp/billing?tab=accounting-exports',
    );

    accountingCapsState.current = {
      ...accountingCapsState.current,
      exportsExecute: false,
    };
    rerender(<CSVIntegrationSettings />);

    expect(screen.queryByRole('link', { name: 'Open Accounting Exports' })).not.toBeInTheDocument();
  });
});
