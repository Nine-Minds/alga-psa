/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ClientInfoStep } from '../../../../../packages/onboarding/src/components/steps/ClientInfoStep';
import type { WizardData } from '@alga-psa/types';

const interpolate = (template: string, values: Record<string, unknown> = {}) =>
  template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_match, key) => String(values[key] ?? ''));

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({
    t: (_key: string, options?: Record<string, unknown>) => {
      const template = String(options?.defaultValue ?? _key);
      return interpolate(template, options);
    },
  }),
  useI18n: () => ({
    locale: 'en',
    setLocale: vi.fn(),
  }),
}));

vi.mock('@alga-psa/validation', () => ({
  validateEmailAddress: () => null,
  toValidationTranslator: (t: (key: string, defaultValue: string) => unknown) =>
    (key: string, defaultValue: string) => {
      const translated = t(key, defaultValue);
      return typeof translated === 'string' && translated ? translated : defaultValue;
    },
}));

// ClientInfoStep loads the country list through a server action on mount. Left
// unmocked it opens a real tenant DB pool whose late log/rejection outlives the
// test file and tears down the vitest worker mid-RPC.
const { getAllCountriesMock } = vi.hoisted(() => ({
  getAllCountriesMock: vi.fn(),
}));

vi.mock('@alga-psa/clients/actions', () => ({
  getAllCountries: getAllCountriesMock,
}));

beforeEach(() => {
  getAllCountriesMock.mockReset();
  getAllCountriesMock.mockResolvedValue([]);
});

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

// Render and let the mount-time country load settle inside act().
const renderStep = async (ui: React.ReactElement) => {
  await act(async () => {
    render(ui);
  });
};

describe('ClientInfoStep rendering', () => {
  describe('revisit mode', () => {
    it('renders only company name field', async () => {
      const data = makeWizardData({ tenantName: 'My MSP' });
      await renderStep(<ClientInfoStep data={data} updateData={vi.fn()} isRevisit />);

      // Should show company name
      expect(screen.getByDisplayValue('My MSP')).toBeInTheDocument();

      // Should show revisit-specific heading
      expect(screen.getByText('Company Information')).toBeInTheDocument();
      expect(screen.getByText('Review or update your company details.')).toBeInTheDocument();

      // Should NOT show first-time fields
      expect(screen.queryByPlaceholderText('John')).not.toBeInTheDocument();
      expect(screen.queryByPlaceholderText('Doe')).not.toBeInTheDocument();
      expect(screen.queryByText('Set Your Password')).not.toBeInTheDocument();
    });

    it('shows reconfigure note', async () => {
      await renderStep(<ClientInfoStep data={makeWizardData()} updateData={vi.fn()} isRevisit />);

      expect(screen.getByText(/reconfigure your workspace settings/)).toBeInTheDocument();
    });

    it('updates tenantName on input change', async () => {
      const updateData = vi.fn();
      await renderStep(<ClientInfoStep data={makeWizardData()} updateData={updateData} isRevisit />);

      const input = screen.getByPlaceholderText('Acme IT Solutions');
      await userEvent.type(input, 'X');

      expect(updateData).toHaveBeenCalledWith({ tenantName: 'X' });
    });
  });

  describe('first-time mode', () => {
    it('renders all identity fields', async () => {
      await renderStep(<ClientInfoStep data={makeWizardData()} updateData={vi.fn()} />);

      // Should show first-time heading
      expect(screen.getByText('Your Company & Admin Account')).toBeInTheDocument();

      // Should show all fields
      expect(screen.getByPlaceholderText('John')).toBeInTheDocument();       // firstName
      expect(screen.getByPlaceholderText('Doe')).toBeInTheDocument();        // lastName
      expect(screen.getByPlaceholderText('Acme IT Solutions')).toBeInTheDocument(); // tenantName
      expect(screen.getByPlaceholderText('john@acmeit.com')).toBeInTheDocument();  // email
    });

    it('renders password fields', async () => {
      await renderStep(<ClientInfoStep data={makeWizardData()} updateData={vi.fn()} />);

      expect(screen.getByText('Set Your Password')).toBeInTheDocument();
      expect(screen.getByPlaceholderText('Create a strong password')).toBeInTheDocument();
      expect(screen.getByPlaceholderText('Re-enter your password')).toBeInTheDocument();
    });

    it('shows password reset required warning', async () => {
      await renderStep(<ClientInfoStep data={makeWizardData()} updateData={vi.fn()} />);

      expect(screen.getByText('Password Reset Required')).toBeInTheDocument();
    });

    it('renders pre-filled values', async () => {
      const data = makeWizardData({
        firstName: 'Jane',
        lastName: 'Smith',
        tenantName: 'Smith IT',
        email: 'jane@smithit.com',
      });
      await renderStep(<ClientInfoStep data={data} updateData={vi.fn()} />);

      expect(screen.getByDisplayValue('Jane')).toBeInTheDocument();
      expect(screen.getByDisplayValue('Smith')).toBeInTheDocument();
      expect(screen.getByDisplayValue('Smith IT')).toBeInTheDocument();
      expect(screen.getByDisplayValue('jane@smithit.com')).toBeInTheDocument();
    });

    it('email field is disabled', async () => {
      const data = makeWizardData({ email: 'jane@example.com' });
      await renderStep(<ClientInfoStep data={data} updateData={vi.fn()} />);

      const emailInput = screen.getByDisplayValue('jane@example.com');
      expect(emailInput).toBeDisabled();
    });
  });

  describe('password strength indicator', () => {
    it('shows weak for short simple password', async () => {
      const data = makeWizardData({ newPassword: 'abc' });
      await renderStep(<ClientInfoStep data={data} updateData={vi.fn()} />);

      expect(screen.getByText(/Password strength: Weak/)).toBeInTheDocument();
    });

    it('shows medium for moderate password', async () => {
      const data = makeWizardData({ newPassword: 'Abcd1234' });
      await renderStep(<ClientInfoStep data={data} updateData={vi.fn()} />);

      expect(screen.getByText(/Password strength: Medium/)).toBeInTheDocument();
    });

    it('shows strong for complex password', async () => {
      const data = makeWizardData({ newPassword: 'Abcd1234!' });
      await renderStep(<ClientInfoStep data={data} updateData={vi.fn()} />);

      expect(screen.getByText(/Password strength: Strong/)).toBeInTheDocument();
    });

    it('shows no strength indicator when password is empty', async () => {
      await renderStep(<ClientInfoStep data={makeWizardData()} updateData={vi.fn()} />);

      expect(screen.queryByText(/Password strength:/)).not.toBeInTheDocument();
    });
  });

  describe('password mismatch', () => {
    it('shows mismatch warning when passwords differ', async () => {
      const data = makeWizardData({
        newPassword: 'Password1!',
        confirmPassword: 'Password2!',
      });
      await renderStep(<ClientInfoStep data={data} updateData={vi.fn()} />);

      expect(screen.getByText('Passwords do not match')).toBeInTheDocument();
    });

    it('shows no mismatch warning when passwords match', async () => {
      const data = makeWizardData({
        newPassword: 'Password1!',
        confirmPassword: 'Password1!',
      });
      await renderStep(<ClientInfoStep data={data} updateData={vi.fn()} />);

      expect(screen.queryByText('Passwords do not match')).not.toBeInTheDocument();
    });

    it('shows no mismatch warning when confirm is empty', async () => {
      const data = makeWizardData({
        newPassword: 'Password1!',
        confirmPassword: '',
      });
      await renderStep(<ClientInfoStep data={data} updateData={vi.fn()} />);

      expect(screen.queryByText('Passwords do not match')).not.toBeInTheDocument();
    });
  });

  describe('company country', () => {
    it('loads countries from the country action and shows the saved selection', async () => {
      getAllCountriesMock.mockResolvedValue([
        { code: 'CA', name: 'Canada' },
        { code: 'NL', name: 'Netherlands' },
      ]);
      const data = makeWizardData({ companyCountryCode: 'NL' });
      await renderStep(<ClientInfoStep data={data} updateData={vi.fn()} />);

      expect(getAllCountriesMock).toHaveBeenCalledTimes(1);
      expect(screen.getByText('Netherlands (NL)')).toBeInTheDocument();
    });
  });
});
