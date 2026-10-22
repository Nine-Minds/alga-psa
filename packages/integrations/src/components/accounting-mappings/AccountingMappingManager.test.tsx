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

// The adapter managers pull their module definitions from factories that
// value-import server actions at module scope.
vi.mock('@alga-psa/integrations/actions', () => ({
  createExternalEntityMapping: vi.fn(),
  createExternalEntityMappings: vi.fn(),
  deleteExternalEntityMapping: vi.fn(),
  getExternalEntityMappings: vi.fn(),
  getQboAutomatedSalesTaxMode: vi.fn(),
  getQboCompanyCountryInfo: vi.fn(),
  getQboItems: vi.fn(),
  getQboTaxCodes: vi.fn(),
  getQboTerms: vi.fn(),
  getServices: vi.fn(),
  getTaxRegions: vi.fn(),
  getXeroAccounts: vi.fn(),
  getXeroItems: vi.fn(),
  getXeroTaxRates: vi.fn(),
  updateExternalEntityMapping: vi.fn()
}));

vi.mock('../../actions/clientLookupActions', () => ({
  getIntegrationClients: vi.fn()
}));

// The managers reach the manager through the package barrel, which also drags
// in unrelated component surfaces; serve them the real component directly.
vi.mock('@alga-psa/integrations/components', async () => ({
  AccountingMappingManager: (await import('./AccountingMappingManager')).AccountingMappingManager
}));

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key
  })
}));

import { AccountingMappingManager } from './AccountingMappingManager';
import type { AccountingMappingModule } from './types';
import { CSVMappingManager } from '../csv/CSVMappingManager';
import { XeroCsvMappingManager } from '../csv/XeroCsvMappingManager';
import { QboLiveMappingManager } from '../qbo/QboLiveMappingManager';
import { XeroLiveMappingManager } from '../xero/XeroLiveMappingManager';
import { createCsvMappingModules } from '../csv/csvMappingModules';
import { createXeroCsvMappingModules } from '../csv/xeroCsvMappingModules';
import { createQboLiveMappingModules } from '../qbo/qboLiveMappingModules';
import { createXeroLiveMappingModules } from '../xero/xeroLiveMappingModules';

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

const t = (key: string, options?: Record<string, unknown>) =>
  (options?.defaultValue as string | undefined) ?? key;

const adapterManagers = [
  {
    name: 'QboLiveMappingManager',
    moduleCount: createQboLiveMappingModules(t).length,
    renderManager: () => render(
      <QboLiveMappingManager
        defaultConnection={{ realmId: 'realm-1', displayName: 'Acme Books', status: 'active' }}
      />
    )
  },
  {
    name: 'XeroLiveMappingManager',
    moduleCount: createXeroLiveMappingModules(t).length,
    renderManager: () => render(
      <XeroLiveMappingManager
        defaultConnection={{ connectionId: 'xero-conn-1', xeroTenantId: 'org-guid-1', tenantName: 'Acme Holdings' }}
      />
    )
  },
  {
    name: 'XeroCsvMappingManager',
    moduleCount: createXeroCsvMappingModules(t).length,
    renderManager: () => render(<XeroCsvMappingManager />)
  },
  {
    name: 'CSVMappingManager',
    moduleCount: createCsvMappingModules(t).length,
    renderManager: () => render(<CSVMappingManager />)
  }
];

describe('accounting mapping tab strip layout', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    window.history.replaceState({}, '', '/');
  });

  // A fixed-column grid list silently wraps the surplus tab onto a second row
  // whenever a module is added, so the list must stay count-agnostic. Any
  // `grid*` token fails the assertion: a bare `grid` still beats the default
  // `flex` in the cascade and stacks every tab into a single column. A flex
  // list instead holds one row for as long as the triggers fit: the
  // four-module Xero CSV strip measures 454px of the 1074px available at a
  // 1440px viewport. QuickBooks CSV already exceeds that — its eight modules
  // (five CSV plus three QuickBooks Desktop) need 1111px, so its last trigger
  // wraps on intrinsic width alone, which is a content-width problem rather
  // than the fixed-grid bug guarded here.
  it.each(adapterManagers)('renders every $name module without grid-constraining the list', ({ moduleCount, renderManager }) => {
    renderManager();

    expect(moduleCount).toBeGreaterThan(0);
    expect(screen.getAllByRole('tab')).toHaveLength(moduleCount);
    expect(screen.getByRole('tablist').className).not.toMatch(/\bgrid\b/);
  });

  // The QBO and Xero live strips only render once an external organisation is
  // connected, so they cannot be exercised in a browser without live OAuth.
  // Pinning all four adapters to one list class lets the browser-verified Xero
  // CSV strip stand in for the two live screens. Assert `flex-wrap` rather than
  // `flex`: CustomTabs' own default list class already contains `flex`, so that
  // token passes even when a manager forwards no override at all, while
  // `flex-wrap` can only come from the managers.
  it('hands every adapter the same tab list class', () => {
    const listClasses = adapterManagers.map(({ renderManager }) => {
      renderManager();
      const listClass = screen.getByRole('tablist').className;
      cleanup();
      return listClass;
    });

    expect(new Set(listClasses).size).toBe(1);
    expect(listClasses[0]).toContain('flex-wrap');
    expect(listClasses[0]).not.toMatch(/\bgrid\b/);
  });
});
