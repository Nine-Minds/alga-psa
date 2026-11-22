// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClientLocationView } from '@alga-psa/types';

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
  renders: 0,
  translate: (key: string, fallback: any) => typeof fallback === 'string' ? fallback : fallback?.defaultValue ?? key,
}));

vi.mock('@alga-psa/clients/actions', () => fallbackActions);
vi.mock('../../lib/billingHelpers', () => ({ getActiveTaxRegionsAsync: fallbackActions.getActiveTaxRegionsAsync }));
vi.mock('@alga-psa/clients/actions/clientBillingProfileActions', () => ({ getClientBillingProfiles: fallbackActions.getClientBillingProfiles }));
vi.mock('@alga-psa/ui', async () => {
  const { useToast } = await import('../../../../ui/src/hooks/use-toast');
  return { useToast: () => {
    // Bound a reload regression so the production-hook test fails without hanging the runner.
    if (++fallbackActions.renders > 50) throw new Error('Location loading keeps rerendering');
    return useToast();
  } };
});
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({ useTranslation: () => ({ t: fallbackActions.translate }) }));
vi.mock('@alga-psa/ui/ui-reflection/useAutomationIdAndRegister', () => ({ useAutomationIdAndRegister: () => ({ automationIdProps: {}, updateMetadata: vi.fn() }) }));
vi.mock('@alga-psa/ui/ui-reflection/ReflectionContainer', () => ({ ReflectionContainer: ({ children }: any) => <div>{children}</div> }));

import ClientLocations from './ClientLocations';

const protectedActionRows: ClientLocationView[] = [{
  location_id: 'loc-1', tenant: 'tenant-1', client_id: 'client-1', location_name: 'HQ',
  address_line1: null, address_line2: null, address_line3: null, city: null, state_province: null,
  postal_code: null, country_code: null, country_name: null, region_code: null,
  email: null, phone: null, phone_extension: null, fax: null, fax_extension: null,
  is_active: true, is_default: true, is_billing_address: false, is_shipping_address: false,
  notes: null, created_at: '2026-01-01', updated_at: '2026-01-01',
  redactedFields: ['address_line1', 'address_line2', 'address_line3', 'city', 'state_province',
    'postal_code', 'country_code', 'country_name', 'region_code', 'email', 'phone', 'phone_extension', 'fax', 'fax_extension'],
}];

describe('ClientLocations quick-view authorization boundary', () => {
  beforeEach(() => { fallbackActions.renders = 0; vi.clearAllMocks(); });
  afterEach(() => cleanup());

  it('loads once with the production toast hook and renders only protected fields', async () => {
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
    expect(await screen.findByLabelText('Address Line 1')).toBeTruthy();
    expect((screen.getByLabelText('Address Line 1') as HTMLInputElement).value).toBe('');
    expect((document.getElementById('email-input') as HTMLInputElement).value).toBe('');
    expect((document.querySelector('[data-automation-id="phone-input"] input') as HTMLInputElement | null)?.value ?? '').toBe('');
    expect(document.body.textContent).not.toContain('SECRET-EMAIL');
    expect(document.body.textContent).not.toContain('SECRET-PHONE');
    expect(document.body.textContent).not.toContain('SECRET-ADDRESS');
    await waitFor(() => expect(loadLocations).toHaveBeenCalledTimes(1));
  });

  it('saves a visible name without validating or overwriting hidden address and contact fields', async () => {
    let stored = { location_name: 'HQ', address_line1: 'SECRET-ADDRESS', city: 'SECRET-CITY', email: 'SECRET-EMAIL' };
    const loadLocations = vi.fn(async () => [{ ...protectedActionRows[0], location_name: stored.location_name }]);
    const updateLocation = vi.fn(async (_locationId: string, patch: object) => { stored = { ...stored, ...patch }; });
    render(<ClientLocations clientId="client-1" isEditing loadLocations={loadLocations} updateLocation={updateLocation} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Edit location' }));
    expect(screen.getByLabelText('Address Line 1')).toBeDisabled();
    expect(screen.getByLabelText('City')).toBeDisabled();
    expect(document.getElementById('email-input')).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Location Name'), { target: { value: 'HQ Updated' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Location' }));

    await waitFor(() => expect(updateLocation).toHaveBeenCalledWith('loc-1', { location_name: 'HQ Updated' }));
    expect(await screen.findByText('HQ Updated')).toBeTruthy();
    expect(stored).toEqual({ location_name: 'HQ Updated', address_line1: 'SECRET-ADDRESS', city: 'SECRET-CITY', email: 'SECRET-EMAIL' });
    expect(loadLocations).toHaveBeenCalledTimes(2);
    expect(document.body.textContent).not.toContain('SECRET');
  });

  it('keeps required-field validation for new locations', async () => {
    const loadLocations = vi.fn(async () => []);
    render(<ClientLocations clientId="client-1" isEditing loadLocations={loadLocations} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Add Location' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save Location' }));

    expect(await screen.findByText('Please fill in the required fields:')).toBeTruthy();
    expect(fallbackActions.createClientLocation).not.toHaveBeenCalled();
  });

  it('keeps empty visible contact fields editable and saves an intentional clear as a partial update', async () => {
    const loadLocations = vi.fn(async () => [{
      ...protectedActionRows[0], redactedFields: [], address_line1: '1 Main St', city: 'Seattle',
      country_code: 'US', country_name: 'United States', email: 'old@example.test',
    }]);
    const updateLocation = vi.fn(async () => undefined);
    render(<ClientLocations clientId="client-1" isEditing loadLocations={loadLocations} updateLocation={updateLocation} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit location' }));
    expect(document.getElementById('email-input')).not.toBeDisabled();
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Location' }));

    await waitFor(() => expect(updateLocation).toHaveBeenCalledWith('loc-1', { email: '' }));
  });


  it('retains country-code repair when an existing location uses a legacy alias', async () => {
    const loadLocations = vi.fn(async () => [{
      ...protectedActionRows[0], redactedFields: [], address_line1: '1 Main St', city: 'Seattle',
      country_code: 'USA', country_name: 'United States',
    }]);
    const updateLocation = vi.fn(async () => undefined);
    render(<ClientLocations clientId="client-1" isEditing loadLocations={loadLocations} updateLocation={updateLocation} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit location' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save Location' }));

    await waitFor(() => expect(updateLocation).toHaveBeenCalledWith('loc-1', { country_code: 'US' }));
  });

});
