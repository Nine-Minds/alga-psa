/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AddClientStep } from '../../../../../packages/onboarding/src/components/steps/AddClientStep';
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

describe('AddClientStep field validation', () => {
  describe('email validation', () => {
    it('shows no error before interaction', () => {
      render(<AddClientStep data={makeWizardData({ clientEmail: 'bad' })} updateData={vi.fn()} />);
      expect(screen.queryByText('Please enter a valid email address')).not.toBeInTheDocument();
    });

    it('shows error for invalid email after blur', async () => {
      const updateData = vi.fn();
      const data = makeWizardData({ clientEmail: 'not-an-email' });
      render(<AddClientStep data={data} updateData={updateData} />);

      const input = screen.getByPlaceholderText('contact@example.com');
      await userEvent.click(input);
      await userEvent.tab(); // blur

      await waitFor(() => {
        expect(screen.getByText('Please enter a valid email address')).toBeInTheDocument();
      });
    });

    it('shows no error for valid email after blur', async () => {
      const data = makeWizardData({ clientEmail: 'user@example.com' });
      render(<AddClientStep data={data} updateData={vi.fn()} />);

      const input = screen.getByPlaceholderText('contact@example.com');
      await userEvent.click(input);
      await userEvent.tab();

      await waitFor(() => {
        expect(screen.queryByText('Please enter a valid email address')).not.toBeInTheDocument();
      });
    });

    it('shows no error when email is empty after blur', async () => {
      const data = makeWizardData({ clientEmail: '' });
      render(<AddClientStep data={data} updateData={vi.fn()} />);

      const input = screen.getByPlaceholderText('contact@example.com');
      await userEvent.click(input);
      await userEvent.tab();

      expect(screen.queryByText('Please enter a valid email address')).not.toBeInTheDocument();
    });
  });

  describe('URL validation', () => {
    it('shows no error before interaction', () => {
      render(<AddClientStep data={makeWizardData({ clientUrl: 'bad' })} updateData={vi.fn()} />);
      expect(screen.queryByText(/valid website/)).not.toBeInTheDocument();
    });

    it('shows error for URL without a dot after blur', async () => {
      const data = makeWizardData({ clientUrl: 'nodot' });
      render(<AddClientStep data={data} updateData={vi.fn()} />);

      const input = screen.getByPlaceholderText('https://example.com');
      await userEvent.click(input);
      await userEvent.tab();

      await waitFor(() => {
        expect(screen.getByText('Please enter a valid website (e.g., example.com)')).toBeInTheDocument();
      });
    });

    it('shows format error for URL with dot but invalid pattern after blur', async () => {
      const data = makeWizardData({ clientUrl: 'not.valid.$$' });
      render(<AddClientStep data={data} updateData={vi.fn()} />);

      const input = screen.getByPlaceholderText('https://example.com');
      await userEvent.click(input);
      await userEvent.tab();

      await waitFor(() => {
        expect(screen.getByText('Please enter a valid website format')).toBeInTheDocument();
      });
    });

    it('accepts valid URLs', async () => {
      const validUrls = ['example.com', 'www.example.com', 'https://example.com', 'sub.example.co.uk'];

      for (const url of validUrls) {
        const data = makeWizardData({ clientUrl: url });
        const { unmount } = render(<AddClientStep data={data} updateData={vi.fn()} />);

        const input = screen.getByPlaceholderText('https://example.com');
        await userEvent.click(input);
        await userEvent.tab();

        await waitFor(() => {
          expect(screen.queryByText(/valid website/)).not.toBeInTheDocument();
        });

        unmount();
      }
    });
  });

  describe('phone validation', () => {
    it('shows no error before interaction', () => {
      render(<AddClientStep data={makeWizardData({ clientPhone: '1' })} updateData={vi.fn()} />);
      expect(screen.queryByText(/phone number seems/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/phone number contains/i)).not.toBeInTheDocument();
    });

    it('shows too-short error for phone under 7 digits after blur', async () => {
      const data = makeWizardData({ clientPhone: '12345' });
      render(<AddClientStep data={data} updateData={vi.fn()} />);

      const input = screen.getByPlaceholderText('+1 (555) 123-4567');
      await userEvent.click(input);
      await userEvent.tab();

      await waitFor(() => {
        expect(screen.getByText('Phone number seems too short')).toBeInTheDocument();
      });
    });

    it('shows too-long error for phone over 20 digits after blur', async () => {
      const data = makeWizardData({ clientPhone: '123456789012345678901' });
      render(<AddClientStep data={data} updateData={vi.fn()} />);

      const input = screen.getByPlaceholderText('+1 (555) 123-4567');
      await userEvent.click(input);
      await userEvent.tab();

      await waitFor(() => {
        expect(screen.getByText('Phone number seems too long')).toBeInTheDocument();
      });
    });

    it('shows invalid characters error after blur', async () => {
      const data = makeWizardData({ clientPhone: '555-123-####' });
      render(<AddClientStep data={data} updateData={vi.fn()} />);

      const input = screen.getByPlaceholderText('+1 (555) 123-4567');
      await userEvent.click(input);
      await userEvent.tab();

      await waitFor(() => {
        expect(screen.getByText('Phone number contains invalid characters')).toBeInTheDocument();
      });
    });

    it('accepts valid phone numbers', async () => {
      const validPhones = ['+1 (555) 123-4567', '5551234567', '+44 20 7946 0958'];

      for (const phone of validPhones) {
        const data = makeWizardData({ clientPhone: phone });
        const { unmount } = render(<AddClientStep data={data} updateData={vi.fn()} />);

        const input = screen.getByPlaceholderText('+1 (555) 123-4567');
        await userEvent.click(input);
        await userEvent.tab();

        await waitFor(() => {
          expect(screen.queryByText(/phone number seems/i)).not.toBeInTheDocument();
          expect(screen.queryByText(/phone number contains/i)).not.toBeInTheDocument();
        });

        unmount();
      }
    });
  });

  describe('client created state', () => {
    it('shows success alert when clientId is set', () => {
      const data = makeWizardData({ clientId: 'abc-123', clientName: 'Acme Corp' });
      render(<AddClientStep data={data} updateData={vi.fn()} />);

      expect(screen.getByText('Client created successfully!')).toBeInTheDocument();
      expect(screen.getByText('Acme Corp has been added to your client list.')).toBeInTheDocument();
    });

    it('does not show success alert when clientId is not set', () => {
      render(<AddClientStep data={makeWizardData()} updateData={vi.fn()} />);

      expect(screen.queryByText('Client created successfully!')).not.toBeInTheDocument();
    });
  });
});
