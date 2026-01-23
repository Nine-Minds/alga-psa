// @vitest-environment jsdom

import '@testing-library/jest-dom';
import React from 'react';
import { beforeAll, afterAll, beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';

import { GmailProviderForm } from '@alga-psa/integrations/components';
import type { EmailProvider } from '@alga-psa/integrations/components';
import { TestContext } from '../../../test-utils/testContext';
import * as tenantActions from '../../lib/actions/tenantActions';
import * as userActions from '../../lib/actions/user-actions/userActions';
import { getSecretProviderInstance } from '@alga-psa/core/secrets';

const localStorageProviderMock = vi.hoisted(() => ({
  LocalStorageProvider: class {
    getCapabilities() {
      return {
        supportsBuckets: false,
        supportsStreaming: false,
        supportsMetadata: false,
        supportsTags: false,
        supportsVersioning: false,
        maxFileSize: 0,
        allowedMimeTypes: []
      };
    }
  }
}));

vi.mock('server/src/lib/storage/providers/LocalStorageProvider', () => localStorageProviderMock);
vi.mock('@alga-psa/documents/handlers/VideoDocumentHandler', () => ({
  VideoDocumentHandler: class {
    canHandle() {
      return false;
    }
  }
}));

vi.mock('../../lib/actions/email-actions/inboundTicketDefaultsActions', () => ({
  getInboundTicketDefaults: vi.fn().mockResolvedValue({ defaults: [] })
}));

vi.mock('../../lib/actions/email-actions/configureGmailProvider', () => ({
  configureGmailProvider: vi.fn().mockResolvedValue(undefined)
}));

vi.mock('@/lib/actions/integrations/googleActions', () => ({
  getGoogleIntegrationStatus: vi.fn().mockResolvedValue({
    success: true,
    config: {
      projectId: 'test-project',
      gmailClientId: 'test-client.apps.googleusercontent.com',
      gmailClientSecretMasked: '••••cret',
      calendarClientId: 'test-client.apps.googleusercontent.com',
      calendarClientSecretMasked: '••••cret',
      hasServiceAccountKey: true,
      usingSharedOAuthApp: true,
    },
  }),
}));

vi.mock('@alga-psa/core', () => {
  const getAppSecret = vi.fn().mockResolvedValue(undefined);
  const tenantSecrets = new Map<string, Map<string, string>>();

  return {
    getSecretProviderInstance: vi.fn().mockResolvedValue({
      getAppSecret,
      setAppSecret: vi.fn().mockResolvedValue(undefined),
      deleteAppSecret: vi.fn().mockResolvedValue(undefined),
      listAppSecrets: vi.fn().mockResolvedValue([]),
      getTenantSecret: vi.fn(async (tenant: string, key: string) => tenantSecrets.get(tenant)?.get(key)),
      setTenantSecret: vi.fn(async (tenant: string, key: string, value: string) => {
        const bucket = tenantSecrets.get(tenant) ?? new Map<string, string>();
        bucket.set(key, value);
        tenantSecrets.set(tenant, bucket);
      }),
      deleteTenantSecret: vi.fn(async (tenant: string, key: string) => {
        tenantSecrets.get(tenant)?.delete(key);
      })
    })
  };
});

process.env.DB_USER_SERVER = process.env.DB_USER_SERVER || 'app_user';
process.env.DB_PASSWORD_SERVER = process.env.DB_PASSWORD_SERVER || 'test_password';
process.env.DB_PASSWORD_ADMIN = process.env.DB_PASSWORD_ADMIN || 'test_password';
process.env.DB_HOST = process.env.DB_HOST || '127.0.0.1';
process.env.DB_PORT = process.env.DB_PORT || '5432';
process.env.DB_NAME_SERVER = process.env.DB_NAME_SERVER || 'sebastian_test';

const testHelpers = TestContext.createHelpers();

describe('Email Provider UI Integration', () => {
  let ctx: TestContext;
  let db: Knex;
  let tenantId: string;
  let getCurrentTenantSpy: ReturnType<typeof vi.spyOn> | undefined;
  let getCurrentUserSpy: ReturnType<typeof vi.spyOn> | undefined;

  beforeAll(async () => {
    ctx = await testHelpers.beforeAll({
      cleanupTables: [
        'google_email_provider_config',
        'email_providers',
        'email_provider_configs',
        'email_processed_messages'
      ]
    });
    db = ctx.db;
    tenantId = ctx.tenantId;
  });

  afterAll(async () => {
    await testHelpers.afterAll();
  });

  beforeEach(async () => {
    ctx = await testHelpers.beforeEach();
    db = ctx.db;
    tenantId = ctx.tenantId;

    getCurrentTenantSpy?.mockRestore();
    getCurrentUserSpy?.mockRestore();

    getCurrentTenantSpy = vi.spyOn(tenantActions, 'getCurrentTenant').mockResolvedValue(tenantId);
    getCurrentUserSpy = vi.spyOn(userActions, 'getCurrentUser').mockResolvedValue({
      ...ctx.user,
      tenant: tenantId
    } as any);

    const secretProvider = await getSecretProviderInstance();
    await secretProvider.setTenantSecret(tenantId, 'google_project_id', 'test-project');
    await secretProvider.setTenantSecret(tenantId, 'google_client_id', 'test-client.apps.googleusercontent.com');
    await secretProvider.setTenantSecret(tenantId, 'google_client_secret', 'test-client-secret');
    await secretProvider.setTenantSecret(
      tenantId,
      'google_service_account_key',
      JSON.stringify({ type: 'service_account', project_id: 'test-project' })
    );
  });

  afterEach(async () => {
    await testHelpers.afterEach();
    getCurrentTenantSpy?.mockRestore();
    getCurrentUserSpy?.mockRestore();
    getCurrentTenantSpy = undefined;
    getCurrentUserSpy = undefined;
  });

  it('saves a Gmail provider when the form is submitted', async () => {
    const user = userEvent.setup();
    const onSuccess = vi.fn();
    const onCancel = vi.fn();

    render(
      <GmailProviderForm
        tenant={tenantId}
        onSuccess={onSuccess}
        onCancel={onCancel}
      />
    );

    await user.type(screen.getByPlaceholderText('e.g., Support Gmail'), 'Production Gmail');
    await user.type(screen.getByPlaceholderText('support@client.com'), 'production@client.com');
    const labelsField = screen.getByPlaceholderText('INBOX, Support, Custom Label');
    await user.clear(labelsField);
    await user.type(labelsField, 'INBOX, Escalations');

    await user.click(screen.getByRole('button', { name: /add provider/i }));

    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));

    const baseProvider = await db('email_providers')
      .where({ tenant: tenantId, mailbox: 'production@client.com' })
      .first();

    expect(baseProvider).toBeDefined();
    expect(baseProvider?.provider_name).toBe('Production Gmail');
    expect(baseProvider?.provider_type).toBe('google');
    expect(baseProvider?.is_active).toBe(true);

    const googleConfig = await db('google_email_provider_config')
      .where({ tenant: tenantId, email_provider_id: baseProvider?.id })
      .first();

    expect(googleConfig).toBeDefined();
    expect(googleConfig?.client_id).toBeNull();
    expect(googleConfig?.client_secret).toBeNull();
    expect(googleConfig?.project_id).toBe('test-project');

    const labelFilters = Array.isArray(googleConfig?.label_filters)
      ? googleConfig?.label_filters
      : JSON.parse(googleConfig?.label_filters ?? '[]');

    expect(labelFilters).toEqual(['INBOX', 'Escalations']);
    expect(googleConfig?.pubsub_topic_name).toBe(`gmail-notifications-${tenantId}`);
    expect(googleConfig?.pubsub_subscription_name).toBe(`gmail-webhook-${tenantId}`);
  });

  it('updates an existing Gmail provider when submitted in edit mode', async () => {
    const providerId = uuidv4();
    await db('email_providers').insert({
      id: providerId,
      tenant: tenantId,
      provider_type: 'google',
      provider_name: 'Existing Gmail',
      mailbox: 'existing@client.com',
      is_active: true,
      status: 'disconnected',
      inbound_ticket_defaults_id: null,
      created_at: db.fn.now(),
      updated_at: db.fn.now()
    });

    await db('google_email_provider_config').insert({
      email_provider_id: providerId,
      tenant: tenantId,
      client_id: 'existing-client.apps.googleusercontent.com',
      client_secret: 'existing-secret',
      project_id: 'existing-project',
      redirect_uri: 'http://localhost:3000/api/auth/google/callback',
      pubsub_topic_name: `gmail-notifications-${tenantId}`,
      pubsub_subscription_name: `gmail-webhook-${tenantId}`,
      auto_process_emails: true,
      max_emails_per_sync: 50,
      label_filters: JSON.stringify(['INBOX']),
      created_at: db.fn.now(),
      updated_at: db.fn.now()
    });

    const baseRow = await db('email_providers')
      .where({ id: providerId, tenant: tenantId })
      .first();
    const configRow = await db('google_email_provider_config')
      .where({ email_provider_id: providerId, tenant: tenantId })
      .first();

    const provider: EmailProvider = {
      id: baseRow.id,
      tenant: tenantId,
      providerType: 'google',
      providerName: baseRow.provider_name,
      mailbox: baseRow.mailbox,
      isActive: baseRow.is_active,
      status: baseRow.status,
      lastSyncAt: baseRow.last_sync_at ?? undefined,
      errorMessage: baseRow.error_message ?? undefined,
      createdAt: baseRow.created_at.toISOString(),
      updatedAt: baseRow.updated_at.toISOString(),
      inboundTicketDefaultsId: baseRow.inbound_ticket_defaults_id ?? undefined,
	      googleConfig: {
	        email_provider_id: configRow.email_provider_id,
	        tenant: configRow.tenant,
	        client_id: configRow.client_id,
	        client_secret: configRow.client_secret,
	        project_id: configRow.project_id,
	        redirect_uri: configRow.redirect_uri,
	        auto_process_emails: configRow.auto_process_emails,
	        max_emails_per_sync: configRow.max_emails_per_sync,
	        label_filters: Array.isArray(configRow.label_filters)
	          ? configRow.label_filters
	          : JSON.parse(configRow.label_filters ?? '[]'),
        access_token: configRow.access_token ?? undefined,
        refresh_token: configRow.refresh_token ?? undefined,
        token_expires_at: configRow.token_expires_at ?? undefined,
        history_id: configRow.history_id ?? undefined,
        watch_expiration: configRow.watch_expiration ?? undefined,
        created_at: configRow.created_at.toISOString(),
        updated_at: configRow.updated_at.toISOString()
      }
    };

    const user = userEvent.setup();
    const onSuccess = vi.fn();
    const onCancel = vi.fn();

    render(
      <GmailProviderForm
        tenant={tenantId}
        provider={provider}
        onSuccess={onSuccess}
        onCancel={onCancel}
      />
    );

    const nameInput = screen.getByDisplayValue('Existing Gmail');
    await user.clear(nameInput);
    await user.type(nameInput, 'Updated Gmail');

    const labelsField = screen.getByDisplayValue('INBOX');
    await user.clear(labelsField);
    await user.type(labelsField, 'INBOX, Escalations');

    await user.click(screen.getByRole('button', { name: /update provider/i }));

    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));

    const updatedBase = await db('email_providers')
      .where({ id: providerId, tenant: tenantId })
      .first();
    expect(updatedBase?.provider_name).toBe('Updated Gmail');
    expect(updatedBase?.mailbox).toBe('existing@client.com');

    const updatedConfig = await db('google_email_provider_config')
      .where({ email_provider_id: providerId, tenant: tenantId })
      .first();
    const updatedFilters = Array.isArray(updatedConfig?.label_filters)
      ? updatedConfig?.label_filters
      : JSON.parse(updatedConfig?.label_filters ?? '[]');

    expect(updatedFilters).toEqual(['INBOX', 'Escalations']);
    expect(updatedConfig?.client_id).toBeNull();
    expect(updatedConfig?.client_secret).toBeNull();
    expect(updatedConfig?.project_id).toBe('test-project');
  });

  it('surfaces validation errors when required fields are missing', async () => {
    const user = userEvent.setup();
    const onSuccess = vi.fn();
    const onCancel = vi.fn();

    render(
      <GmailProviderForm
        tenant={tenantId}
        onSuccess={onSuccess}
        onCancel={onCancel}
      />
    );

    await user.click(screen.getByRole('button', { name: /add provider/i }));

    await waitFor(() => {
      expect(screen.getByText(/Provider name is required/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/Valid Gmail address is required/i)).toBeInTheDocument();
    expect(onSuccess).not.toHaveBeenCalled();
  });
});
