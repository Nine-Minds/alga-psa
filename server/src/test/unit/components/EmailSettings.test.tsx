/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { cleanup } from '@testing-library/react';
import type { EmailProvider } from '../../../components/EmailProviderConfiguration';
import { INBOUND_DEFAULTS_WARNING, providerNeedsInboundDefaults } from '../../../components/emailProviderDefaults';

const baseProvider: EmailProvider = {
  id: 'provider-1',
  tenant: 'tenant-123',
  providerType: 'microsoft',
  providerName: 'Support Mailbox',
  mailbox: 'support@example.com',
  isActive: true,
  status: 'connected',
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
  inboundTicketDefaultsId: undefined,
};

describe('Email provider defaults indicator', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('shows warning on providers missing inbound defaults', () => {
    expect(providerNeedsInboundDefaults({ inboundTicketDefaultsId: undefined })).toBe(true);
    expect(INBOUND_DEFAULTS_WARNING).toMatch(/inbound ticket defaults are required/i);
  });

  it('hides warning when provider has inbound defaults selected', () => {
    expect(providerNeedsInboundDefaults({ inboundTicketDefaultsId: 'defaults-1' })).toBe(false);
  });
});
