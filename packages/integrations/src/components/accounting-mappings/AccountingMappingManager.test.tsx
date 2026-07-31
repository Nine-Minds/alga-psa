/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

const routerReplaceMock = vi.hoisted(() => vi.fn());
const useSearchParamsMock = vi.hoisted(() => vi.fn(() => new URLSearchParams()));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: routerReplaceMock }),
  useSearchParams: useSearchParamsMock
}));

vi.mock('./AccountingMappingModuleView', () => ({
  AccountingMappingModuleView: ({ module }: { module: { id: string } }) => (
    <div>{`Panel ${module.id}`}</div>
  )
}));

import { AccountingMappingManager } from './AccountingMappingManager';
import type { AccountingMappingModule } from './types';

const modules = [
  { id: 'service-mappings', labels: { tab: 'Items / Services' } },
  { id: 'tax-mappings', labels: { tab: 'Tax Codes' } }
] as unknown as AccountingMappingModule[];

describe('AccountingMappingManager tab selection', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    window.history.replaceState({}, '', '/');
  });

  it('falls back to the first module when defaultTabId is a stale label', () => {
    render(
      <AccountingMappingManager
        modules={modules}
        context={{}}
        defaultTabId="Items / Services"
        urlParamKey="mappingTab"
      />
    );

    expect(screen.getByText('Panel service-mappings')).toBeVisible();
    expect(screen.queryByText('Panel tax-mappings')).not.toBeInTheDocument();
  });

  it('keeps a user-selected tab active and synchronizes it through the router', () => {
    render(
      <AccountingMappingManager
        modules={modules}
        context={{}}
        defaultTabId="service-mappings"
        urlParamKey="mappingTab"
      />
    );

    const taxTab = screen.getByRole('tab', { name: 'Tax Codes' });
    fireEvent.mouseDown(taxTab, { button: 0, ctrlKey: false });
    fireEvent.click(taxTab);

    expect(screen.getByText('Panel tax-mappings')).toBeVisible();
    expect(routerReplaceMock).toHaveBeenCalledWith('/?mappingTab=tax-mappings', { scroll: false });
  });
});
