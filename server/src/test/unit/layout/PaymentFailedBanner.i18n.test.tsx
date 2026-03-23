/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PaymentFailedBanner } from '../../../components/layout/PaymentFailedBanner';

let isPaymentFailed = true;
const toastError = vi.fn();
const createCustomerPortalSessionAction = vi.fn();

vi.mock('@/context/TierContext', () => ({
  useTier: () => ({
    isPaymentFailed,
  }),
}));

vi.mock('@ee/lib/actions/license-actions', () => ({
  createCustomerPortalSessionAction: (...args: unknown[]) => createCustomerPortalSessionAction(...args),
}));

vi.mock('react-hot-toast', () => ({
  toast: {
    error: (...args: unknown[]) => toastError(...args),
  },
}));

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => {
      const map: Record<string, string> = {
        'banners.paymentFailed.message': 'Paiement echoue - mettre a jour le paiement',
        'banners.paymentFailed.portalError': 'Impossible d ouvrir le portail de facturation',
      };
      return map[key] ?? options?.defaultValue ?? key;
    },
  }),
}));

describe('PaymentFailedBanner i18n wiring', () => {
  beforeEach(() => {
    isPaymentFailed = true;
    toastError.mockReset();
    createCustomerPortalSessionAction.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it('T038: banner message is translated', () => {
    render(<PaymentFailedBanner />);

    expect(screen.getByText('Paiement echoue - mettre a jour le paiement')).toBeInTheDocument();
  });

  it('T039: billing portal failure toast is translated', async () => {
    createCustomerPortalSessionAction.mockResolvedValue({ success: false });

    render(<PaymentFailedBanner />);
    fireEvent.click(screen.getByRole('button', { name: 'Paiement echoue - mettre a jour le paiement' }));

    await waitFor(() => {
      expect(toastError).toHaveBeenCalledWith('Impossible d ouvrir le portail de facturation');
    });
  });
});
