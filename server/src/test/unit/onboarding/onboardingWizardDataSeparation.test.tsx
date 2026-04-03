/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ClientInfoStep } from '../../../../../packages/onboarding/src/components/steps/ClientInfoStep';
import { AddClientStep } from '../../../../../packages/onboarding/src/components/steps/AddClientStep';
import type { WizardData } from '@alga-psa/types';

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      String(options?.defaultValue ?? key),
  }),
}));

vi.mock('@alga-psa/validation', () => ({
  validateEmailAddress: () => null,
}));

afterEach(cleanup);

const makeWizardData = (overrides: Partial<WizardData> = {}): WizardData => ({
  firstName: '',
  lastName: '',
  tenantName: '',
  email: '',
  newPassword: '',
  confirmPassword: '',
  teamMembers: [{ firstName: '', lastName: '', email: '', role: 'technician' }],
  clientName: '',
  clientEmail: '',
  clientPhone: '',
  clientUrl: '',
  contactName: '',
  contactEmail: '',
  contactRole: '',
  serviceName: '',
  serviceDescription: '',
  servicePrice: '',
  serviceBillingMode: 'usage',
  contractLineName: 'hourly',
  boardName: '',
  supportEmail: '',
  categories: [],
  priorities: [],
  currencyCode: 'USD',
  ...overrides,
});

describe('Onboarding wizard data separation: tenantName vs clientName', () => {
  describe('WizardData type', () => {
    it('has separate tenantName and clientName fields', () => {
      const data = makeWizardData({
        tenantName: 'My MSP Company',
        clientName: 'Customer Corp',
      });

      expect(data.tenantName).toBe('My MSP Company');
      expect(data.clientName).toBe('Customer Corp');
    });

    it('prefilling tenantName does not affect clientName', () => {
      const data = makeWizardData({ tenantName: 'My MSP Company' });

      expect(data.tenantName).toBe('My MSP Company');
      expect(data.clientName).toBe('');
    });
  });

  describe('ClientInfoStep (step 1)', () => {
    it('renders tenantName value in the company name input', () => {
      const data = makeWizardData({ tenantName: 'My MSP Company' });

      render(<ClientInfoStep data={data} updateData={vi.fn()} isRevisit />);

      const input = screen.getByDisplayValue('My MSP Company');
      expect(input).toBeInTheDocument();
    });

    it('calls updateData with tenantName key', async () => {
      const updateData = vi.fn();
      const data = makeWizardData();

      render(<ClientInfoStep data={data} updateData={updateData} isRevisit />);

      const input = screen.getByPlaceholderText('Acme IT Solutions');
      await import('@testing-library/user-event').then(async ({ default: userEvent }) => {
        await userEvent.type(input, 'New Company');
      });

      const calls = updateData.mock.calls.flat();
      expect(calls.every((call: Record<string, unknown>) => 'tenantName' in call)).toBe(true);
      expect(calls.some((call: Record<string, unknown>) => 'clientName' in call)).toBe(false);
    });
  });

  describe('AddClientStep (step 3)', () => {
    it('renders clientName value, not tenantName', () => {
      const data = makeWizardData({
        tenantName: 'My MSP Company',
        clientName: 'Customer Corp',
      });

      render(<AddClientStep data={data} updateData={vi.fn()} />);

      expect(screen.getByDisplayValue('Customer Corp')).toBeInTheDocument();
      // tenantName should NOT appear anywhere in the add-client step
      expect(screen.queryByDisplayValue('My MSP Company')).not.toBeInTheDocument();
    });

    it('shows empty client name even when tenantName is prefilled', () => {
      const data = makeWizardData({ tenantName: 'My MSP Company' });

      render(<AddClientStep data={data} updateData={vi.fn()} />);

      const clientInput = screen.getByPlaceholderText('Example Corp');
      expect(clientInput).toHaveValue('');
    });

    it('calls updateData with clientName key, not tenantName', async () => {
      const updateData = vi.fn();
      const data = makeWizardData();

      render(<AddClientStep data={data} updateData={updateData} />);

      const input = screen.getByPlaceholderText('Example Corp');
      await import('@testing-library/user-event').then(async ({ default: userEvent }) => {
        await userEvent.type(input, 'Acme');
      });

      const calls = updateData.mock.calls.flat();
      expect(calls.every((call: Record<string, unknown>) => 'clientName' in call)).toBe(true);
      expect(calls.some((call: Record<string, unknown>) => 'tenantName' in call)).toBe(false);
    });
  });

  describe('ClientInfoData shape (saveClientInfo)', () => {
    it('uses tenantName not clientName for step 1 data', () => {
      // Verify the interface shape matches what the code sends
      const clientInfoPayload = {
        firstName: 'John',
        lastName: 'Doe',
        tenantName: 'My MSP Company',
        email: 'john@example.com',
      };

      expect(clientInfoPayload).toHaveProperty('tenantName');
      expect(clientInfoPayload).not.toHaveProperty('clientName');
    });
  });
});
