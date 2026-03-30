/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

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

describe('ClientInfoStep rendering', () => {
  describe('revisit mode', () => {
    it('renders only company name field', () => {
      const data = makeWizardData({ tenantName: 'My MSP' });
      render(<ClientInfoStep data={data} updateData={vi.fn()} isRevisit />);

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

    it('shows reconfigure note', () => {
      render(<ClientInfoStep data={makeWizardData()} updateData={vi.fn()} isRevisit />);

      expect(screen.getByText(/reconfigure your workspace settings/)).toBeInTheDocument();
    });

    it('updates tenantName on input change', async () => {
      const updateData = vi.fn();
      render(<ClientInfoStep data={makeWizardData()} updateData={updateData} isRevisit />);

      const input = screen.getByPlaceholderText('Acme IT Solutions');
      await userEvent.type(input, 'X');

      expect(updateData).toHaveBeenCalledWith({ tenantName: 'X' });
    });
  });

  describe('first-time mode', () => {
    it('renders all identity fields', () => {
      render(<ClientInfoStep data={makeWizardData()} updateData={vi.fn()} />);

      // Should show first-time heading
      expect(screen.getByText('Client Information')).toBeInTheDocument();

      // Should show all fields
      expect(screen.getByPlaceholderText('John')).toBeInTheDocument();       // firstName
      expect(screen.getByPlaceholderText('Doe')).toBeInTheDocument();        // lastName
      expect(screen.getByPlaceholderText('Acme IT Solutions')).toBeInTheDocument(); // tenantName
      expect(screen.getByPlaceholderText('john@acmeit.com')).toBeInTheDocument();  // email
    });

    it('renders password fields', () => {
      render(<ClientInfoStep data={makeWizardData()} updateData={vi.fn()} />);

      expect(screen.getByText('Set Your Password')).toBeInTheDocument();
      expect(screen.getByPlaceholderText('Create a strong password')).toBeInTheDocument();
      expect(screen.getByPlaceholderText('Re-enter your password')).toBeInTheDocument();
    });

    it('shows password reset required warning', () => {
      render(<ClientInfoStep data={makeWizardData()} updateData={vi.fn()} />);

      expect(screen.getByText('Password Reset Required')).toBeInTheDocument();
    });

    it('renders pre-filled values', () => {
      const data = makeWizardData({
        firstName: 'Jane',
        lastName: 'Smith',
        tenantName: 'Smith IT',
        email: 'jane@smithit.com',
      });
      render(<ClientInfoStep data={data} updateData={vi.fn()} />);

      expect(screen.getByDisplayValue('Jane')).toBeInTheDocument();
      expect(screen.getByDisplayValue('Smith')).toBeInTheDocument();
      expect(screen.getByDisplayValue('Smith IT')).toBeInTheDocument();
      expect(screen.getByDisplayValue('jane@smithit.com')).toBeInTheDocument();
    });

    it('email field is disabled', () => {
      const data = makeWizardData({ email: 'jane@example.com' });
      render(<ClientInfoStep data={data} updateData={vi.fn()} />);

      const emailInput = screen.getByDisplayValue('jane@example.com');
      expect(emailInput).toBeDisabled();
    });
  });

  describe('password strength indicator', () => {
    it('shows weak for short simple password', () => {
      const data = makeWizardData({ newPassword: 'abc' });
      render(<ClientInfoStep data={data} updateData={vi.fn()} />);

      expect(screen.getByText(/Password strength: Weak/)).toBeInTheDocument();
    });

    it('shows medium for moderate password', () => {
      const data = makeWizardData({ newPassword: 'Abcd1234' });
      render(<ClientInfoStep data={data} updateData={vi.fn()} />);

      expect(screen.getByText(/Password strength: Medium/)).toBeInTheDocument();
    });

    it('shows strong for complex password', () => {
      const data = makeWizardData({ newPassword: 'Abcd1234!' });
      render(<ClientInfoStep data={data} updateData={vi.fn()} />);

      expect(screen.getByText(/Password strength: Strong/)).toBeInTheDocument();
    });

    it('shows no strength indicator when password is empty', () => {
      render(<ClientInfoStep data={makeWizardData()} updateData={vi.fn()} />);

      expect(screen.queryByText(/Password strength:/)).not.toBeInTheDocument();
    });
  });

  describe('password mismatch', () => {
    it('shows mismatch warning when passwords differ', () => {
      const data = makeWizardData({
        newPassword: 'Password1!',
        confirmPassword: 'Password2!',
      });
      render(<ClientInfoStep data={data} updateData={vi.fn()} />);

      expect(screen.getByText('Passwords do not match')).toBeInTheDocument();
    });

    it('shows no mismatch warning when passwords match', () => {
      const data = makeWizardData({
        newPassword: 'Password1!',
        confirmPassword: 'Password1!',
      });
      render(<ClientInfoStep data={data} updateData={vi.fn()} />);

      expect(screen.queryByText('Passwords do not match')).not.toBeInTheDocument();
    });

    it('shows no mismatch warning when confirm is empty', () => {
      const data = makeWizardData({
        newPassword: 'Password1!',
        confirmPassword: '',
      });
      render(<ClientInfoStep data={data} updateData={vi.fn()} />);

      expect(screen.queryByText('Passwords do not match')).not.toBeInTheDocument();
    });
  });
});
