/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import type { AccountingMappingModule } from './types';

const useSearchParamsMock = vi.hoisted(() => vi.fn());

vi.mock('next/navigation', () => ({
  useSearchParams: useSearchParamsMock
}));

vi.mock('@alga-psa/ui/components/CustomTabs', () => ({
  default: ({ defaultTab }: { defaultTab?: string }) => (
    <div data-testid="custom-tabs" data-default-tab={defaultTab ?? ''} />
  )
}));

vi.mock('./AccountingMappingModuleView', () => ({
  AccountingMappingModuleView: ({ module }: { module: AccountingMappingModule }) => (
    <div data-testid={`mapping-module-${module.id}`} />
  )
}));

const modules: AccountingMappingModule[] = [
  {
    id: 'qbo-live-service-mappings',
    adapterType: 'quickbooks_online',
    algaEntityType: 'service',
    externalEntityType: 'Item',
    labels: {
      tab: 'Items / Services',
      addButton: 'Add',
      algaColumn: 'Alga',
      externalColumn: 'External',
      dialog: {
        addTitle: 'Add',
        editTitle: 'Edit',
        algaField: 'Alga',
        externalField: 'External'
      },
      deleteConfirmation: {
        title: 'Delete',
        message: () => 'Delete?',
        confirmLabel: 'Delete',
        cancelLabel: 'Cancel'
      }
    },
    load: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn()
  },
  {
    id: 'qbo-live-tax-code-mappings',
    adapterType: 'quickbooks_online',
    algaEntityType: 'tax_code',
    externalEntityType: 'TaxCode',
    labels: {
      tab: 'Tax Codes',
      addButton: 'Add',
      algaColumn: 'Alga',
      externalColumn: 'External',
      dialog: {
        addTitle: 'Add',
        editTitle: 'Edit',
        algaField: 'Alga',
        externalField: 'External'
      },
      deleteConfirmation: {
        title: 'Delete',
        message: () => 'Delete?',
        confirmLabel: 'Delete',
        cancelLabel: 'Cancel'
      }
    },
    load: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn()
  }
];

describe('AccountingMappingManager tab selection', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('falls back to the first module id when a label is supplied as the default tab', async () => {
    useSearchParamsMock.mockReturnValue(new URLSearchParams());
    const { AccountingMappingManager } = await import('./AccountingMappingManager');

    render(
      <AccountingMappingManager
        modules={modules}
        context={{ realmId: 'realm-1' }}
        defaultTabId="Items / Services"
      />
    );

    expect(screen.getByTestId('custom-tabs')).toHaveAttribute('data-default-tab', 'qbo-live-service-mappings');
  });

  it('falls back to the resolved default tab when the URL tab parameter is stale', async () => {
    useSearchParamsMock.mockReturnValue(new URLSearchParams('qboMappingTab=missing-tab'));
    const { AccountingMappingManager } = await import('./AccountingMappingManager');

    render(
      <AccountingMappingManager
        modules={modules}
        context={{ realmId: 'realm-1' }}
        defaultTabId="qbo-live-tax-code-mappings"
        urlParamKey="qboMappingTab"
      />
    );

    expect(screen.getByTestId('custom-tabs')).toHaveAttribute('data-default-tab', 'qbo-live-tax-code-mappings');
  });
});
