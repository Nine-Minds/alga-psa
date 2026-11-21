// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { IClientLocation } from '@alga-psa/types';

const fallbackActions = vi.hoisted(() => ({
  getClientLocations: vi.fn(async () => { throw new Error('unmasked fallback must not be used in a quick view'); }),
  createClientLocation: vi.fn(),
  updateClientLocation: vi.fn(),
  deleteClientLocation: vi.fn(),
  setDefaultClientLocation: vi.fn(),
  getAllCountries: vi.fn(async () => [{ code: 'US', name: 'United States' }]),
  getTenantDefaultCountry: vi.fn(async () => ({ code: 'US', name: 'United States' })),
  getClientBillingProfiles: vi.fn(async () => []),
  getActiveTaxRegionsAsync: vi.fn(async () => []),
  toast: vi.fn(),
  translate: (key: string, fallback: any) => typeof fallback === 'string' ? fallback : fallback?.defaultValue ?? key,
}));

vi.mock('@alga-psa/clients/actions', () => fallbackActions);
vi.mock('../../lib/billingHelpers', () => ({ getActiveTaxRegionsAsync: fallbackActions.getActiveTaxRegionsAsync }));
vi.mock('@alga-psa/clients/actions/clientBillingProfileActions', () => ({ getClientBillingProfiles: fallbackActions.getClientBillingProfiles }));
vi.mock('@alga-psa/ui', () => ({ useToast: () => ({ toast: fallbackActions.toast }) }));
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({ useTranslation: () => ({ t: fallbackActions.translate }) }));
vi.mock('@alga-psa/ui/ui-reflection/useAutomationIdAndRegister', () => ({ useAutomationIdAndRegister: () => ({ automationIdProps: {}, updateMetadata: vi.fn() }) }));
vi.mock('@alga-psa/ui/ui-reflection/ReflectionContainer', () => ({ ReflectionContainer: ({ children }: any) => <div>{children}</div> }));

import ClientLocations from './ClientLocations';

const protectedActionRows: IClientLocation[] = [{
  location_id: 'loc-1', tenant: 'tenant-1', client_id: 'client-1', location_name: 'HQ',
  address_line1: null, address_line2: null, address_line3: null, city: null, state_province: null,
  postal_code: null, country_code: null, country_name: null, region_code: null,
  email: null, phone: null, phone_extension: null, fax: null, fax_extension: null,
  is_active: true, is_default: true, is_billing_address: false, is_shipping_address: false,
  notes: null, created_at: '2026-01-01', updated_at: '2026-01-01',
}] as unknown as IClientLocation[];

describe('ClientLocations quick-view authorization boundary', () => {
  afterEach(() => cleanup());

  it('renders only fields from the protected action response in the details summary', async () => {
    const loadLocations = vi.fn(async () => protectedActionRows);
    render(<ClientLocations clientId="client-1" isEditing={false} loadLocations={loadLocations} />);

    expect(await screen.findByText('HQ')).toBeTruthy();
    expect(loadLocations).toHaveBeenCalledTimes(1);
    expect(fallbackActions.getClientLocations).not.toHaveBeenCalled();
    expect(document.body.textContent).not.toContain('SECRET-EMAIL');
    expect(document.body.textContent).not.toContain('SECRET-PHONE');
    expect(document.body.textContent).not.toContain('SECRET-ADDRESS');
  });

  it('opens the manage dialog from protected rows without restoring redacted values', async () => {
    const loadLocations = vi.fn(async () => protectedActionRows);
    render(<ClientLocations clientId="client-1" isEditing loadLocations={loadLocations} updateLocation={vi.fn()} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Edit location' }));
    expect(await screen.findByLabelText('Address Line 1 *')).toBeTruthy();
    expect((screen.getByLabelText('Address Line 1 *') as HTMLInputElement).value).toBe('');
    expect((document.getElementById('email-input') as HTMLInputElement).value).toBe('');
    expect((document.querySelector('[data-automation-id="phone-input"] input') as HTMLInputElement | null)?.value ?? '').toBe('');
    expect(document.body.textContent).not.toContain('SECRET-EMAIL');
    expect(document.body.textContent).not.toContain('SECRET-PHONE');
    expect(document.body.textContent).not.toContain('SECRET-ADDRESS');
    await waitFor(() => expect(loadLocations).toHaveBeenCalledTimes(1));
  });
});
