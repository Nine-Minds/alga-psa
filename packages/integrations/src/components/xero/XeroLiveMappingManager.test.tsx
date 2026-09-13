/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';

const contextSpy = vi.hoisted(() => vi.fn());

vi.mock('@alga-psa/integrations/actions', () => ({
  createExternalEntityMapping: vi.fn(),
  deleteExternalEntityMapping: vi.fn(),
  getExternalEntityMappings: vi.fn(),
  getServices: vi.fn(),
  getTaxRegions: vi.fn(),
  getXeroAccounts: vi.fn(),
  getXeroItems: vi.fn(),
  getXeroTaxRates: vi.fn(),
  getXeroTrackingCategories: vi.fn(),
  updateExternalEntityMapping: vi.fn()
}));

vi.mock('@alga-psa/integrations/components', () => ({
  AccountingMappingManager: ({ context }: { context: { realmId?: string | null } }) => {
    contextSpy(context);
    return <div data-testid="manager">{String(context.realmId)}</div>;
  }
}));

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({ t: (_key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? _key })
}));

import { XeroLiveMappingManager } from './XeroLiveMappingManager';

afterEach(() => {
  cleanup();
  contextSpy.mockClear();
});

describe('XeroLiveMappingManager mapping identity', () => {
  it('persists and loads mappings against the Xero connection id, not the organisation id', () => {
    render(
      <XeroLiveMappingManager
        defaultConnection={{
          connectionId: 'xero-conn-1',
          xeroTenantId: 'org-guid-1',
          tenantName: 'Acme Holdings',
          status: 'connected'
        }}
      />
    );

    const context = contextSpy.mock.calls[0][0];
    expect(context.realmId).toBe('xero-conn-1');
    expect(context.connectionId).toBe('xero-conn-1');
    // The organisation id remains the display value only.
    expect(context.realmDisplayValue).toBe('Acme Holdings');
    expect(screen.getByTestId('manager')).toHaveTextContent('xero-conn-1');
  });
});
