/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { renderWithProviders } from '../../utils/testWrapper';
import { EmailProviderCard } from '@alga-psa/integrations/components/email/EmailProviderCard';
import type { EmailProvider } from '@alga-psa/integrations/components/email/types';

function microsoftProvider(deliveryMode: 'webhook' | 'polling'): EmailProvider {
  const now = new Date().toISOString();
  return {
    id: '11111111-1111-4111-8111-111111111111',
    tenant: '22222222-2222-4222-8222-222222222222',
    providerType: 'microsoft',
    providerName: 'Support mailbox',
    mailbox: 'support@example.test',
    isActive: true,
    status: 'connected',
    lastSyncAt: now,
    createdAt: now,
    updatedAt: now,
    microsoftConfig: {
      email_provider_id: '11111111-1111-4111-8111-111111111111',
      tenant: '22222222-2222-4222-8222-222222222222',
      client_id: null,
      client_secret: null,
      tenant_id: 'common',
      redirect_uri: 'https://example.test/api/auth/microsoft/callback',
      auto_process_emails: true,
      max_emails_per_sync: 50,
      folder_filters: ['Inbox'],
      delivery_mode: deliveryMode,
      created_at: now,
      updated_at: now,
    },
  };
}

function renderCard(provider: EmailProvider) {
  renderWithProviders(
    <EmailProviderCard
      provider={provider}
      defaultsOptions={[]}
      updatingProviderId={null}
      onEdit={vi.fn()}
      onDelete={vi.fn()}
      onTestConnection={vi.fn()}
      onRefreshWatchSubscription={vi.fn()}
      onRetryRenewal={vi.fn()}
      onRunDiagnostics={vi.fn()}
      onChangeDefaults={vi.fn()}
    />
  );
}

describe('EmailProviderCard Microsoft delivery status', () => {
  it('renders polling as a normal connected delivery mode', () => {
    renderCard(microsoftProvider('polling'));

    expect(screen.getByText('Connected')).toBeInTheDocument();
    expect(screen.getByText('Polling every 3 minutes')).toBeInTheDocument();
    expect(screen.getByText('Last ingested')).toBeInTheDocument();
  });

  it('renders active webhook delivery', () => {
    renderCard(microsoftProvider('webhook'));

    expect(screen.getByText('Real-time delivery: active')).toBeInTheDocument();
  });
});
