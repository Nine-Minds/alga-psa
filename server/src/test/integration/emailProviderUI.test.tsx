/**
 * Integration test for email provider UI functionality
 * Tests the complete flow from UI form submission to database persistence
 */

import React from 'react';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { GmailProviderForm } from '../../components/GmailProviderForm';
import { getCurrentTenant } from '@product/actions/tenantActions';

// @vitest-environment jsdom

let testDb: Knex;
let testTenant: string;

// Mock the tenant functions
vi.mock('@product/actions/tenantActions', () => ({
  getCurrentTenant: vi.fn()
}));

// Mock createTenantKnex to use our test database
vi.mock('../../lib/db', () => ({
  createTenantKnex: vi.fn().mockImplementation(async () => ({
    knex: testDb,
    tenant: testTenant
  }))
}));

describe('Email Provider UI Integration', () => {
  
  beforeAll(async () => {
    testDb = await createTestDbConnection();
    testTenant = uuidv4();
    
    // Create test tenant
    await testDb('tenants').insert({
      tenant: testTenant,
      client_name: 'UI Test Client',
      email: 'ui-test@client.com',
      created_at: new Date(),
      updated_at: new Date()
    });
    
    // Mock getCurrentTenant to return our test tenant
    vi.mocked(getCurrentTenant).mockResolvedValue(testTenant);
  });

  afterAll(async () => {
    // Cleanup
    await testDb('email_provider_configs').where('tenant', testTenant).delete();
    await testDb('tenants').where('tenant', testTenant).delete();
    await testDb.destroy();
  });

  it('should save a Gmail provider to the database when form is submitted', async () => {
    const user = userEvent.setup();
    const mockOnSuccess = vi.fn();
    const mockOnCancel = vi.fn();

    // Render the form
    render(
      <GmailProviderForm
        onSuccess={mockOnSuccess}
        onCancel={mockOnCancel}
      />
    );

    // Fill in the form fields
    await user.type(screen.getByPlaceholderText('e.g., Support Gmail'), 'Production Gmail');
    await user.type(screen.getByPlaceholderText('support@client.com'), 'production@client.com');
    await user.type(screen.getByPlaceholderText('xxxxxxxxx.apps.googleusercontent.com'), 'prod-client-id.apps.googleusercontent.com');
    await user.type(screen.getByPlaceholderText('Enter client secret'), 'prod-client-secret');
    await user.type(screen.getByPlaceholderText('my-project-id'), 'production-project');
    const topicInput = screen.getByPlaceholderText('gmail-notifications');
    await user.clear(topicInput);
    await user.type(topicInput, 'prod-notifications');
    
    const subscriptionInput = screen.getByPlaceholderText('gmail-webhook-subscription');
    await user.clear(subscriptionInput);
    await user.type(subscriptionInput, 'prod-webhook-sub');

    // Submit the form
    const submitButton = screen.getByRole('button', { name: /add provider/i });
    await user.click(submitButton);

    // Wait for the form submission to complete
    await waitFor(() => {
      expect(mockOnSuccess).toHaveBeenCalled();
    }, { timeout: 5000 });

    // Verify the provider was saved to the database
    const savedProvider = await testDb('email_provider_configs')
      .where('tenant', testTenant)
      .where('mailbox', 'production@client.com')
      .first();

    expect(savedProvider).toBeDefined();
    expect(savedProvider.name).toBe('Production Gmail');
    expect(savedProvider.provider_type).toBe('google');
    expect(savedProvider.active).toBe(true);
    
    // Verify the configuration was saved correctly
    const config = savedProvider.provider_config;
    expect(config.clientId).toBe('prod-client-id.apps.googleusercontent.com');
    expect(config.projectId).toBe('production-project');
    expect(config.pubSubTopic).toBe('prod-notifications');
  });

  it('should update an existing Gmail provider when form is submitted in edit mode', async () => {
    const user = userEvent.setup();
    const mockOnSuccess = vi.fn();
    const mockOnCancel = vi.fn();

    // First create a provider directly in the database
    const [existingProvider] = await testDb('email_provider_configs')
      .insert({
        id: testDb.raw('gen_random_uuid()'),
        tenant: testTenant,
        name: 'Existing Gmail',
        provider_type: 'google',
        mailbox: 'existing@client.com',
        active: true,
        connection_status: 'disconnected',
        folder_to_monitor: 'Inbox',
        webhook_notification_url: '',
        provider_config: JSON.stringify({
          clientId: 'existing-client.apps.googleusercontent.com',
          clientSecret: 'existing-secret',
          projectId: 'existing-project',
          pubsubTopicName: 'existing-topic',
          pubsubSubscriptionName: 'existing-sub',
          redirectUri: 'http://localhost:3000/api/auth/google/callback'
        }),
        created_at: new Date(),
        updated_at: new Date()
      })
      .returning('*');

    // Convert to the format expected by the form
    const provider = {
      id: existingProvider.id,
      providerType: 'google' as const,
      providerName: existingProvider.name,
      mailbox: existingProvider.mailbox,
      isActive: existingProvider.active,
      vendorConfig: existingProvider.provider_config
    };

    // Render the form in edit mode
    render(
      <GmailProviderForm
        provider={provider}
        onSuccess={mockOnSuccess}
        onCancel={mockOnCancel}
      />
    );

    // Update the provider name
    const nameInput = screen.getByDisplayValue('Existing Gmail');
    await user.clear(nameInput);
    await user.type(nameInput, 'Updated Gmail');

    // Submit the form
    const submitButton = screen.getByRole('button', { name: /update provider/i });
    await user.click(submitButton);

    // Wait for the update to complete
    await waitFor(() => {
      expect(mockOnSuccess).toHaveBeenCalled();
    }, { timeout: 5000 });

    // Verify the provider was updated in the database
    const updatedProvider = await testDb('email_provider_configs')
      .where('id', existingProvider.id)
      .first();

    expect(updatedProvider.name).toBe('Updated Gmail');
    expect(updatedProvider.mailbox).toBe('existing@client.com'); // Should not change
  });

  it('should show validation errors when required fields are missing', async () => {
    const user = userEvent.setup();
    const mockOnSuccess = vi.fn();
    const mockOnCancel = vi.fn();

    render(
      <GmailProviderForm
        onSuccess={mockOnSuccess}
        onCancel={mockOnCancel}
      />
    );

    // Try to submit without filling required fields
    const submitButton = screen.getByRole('button', { name: /add provider/i });
    
    // The button should be disabled initially
    expect(submitButton).toBeDisabled();

    // Fill only some fields
    await user.type(screen.getByPlaceholderText('e.g., Support Gmail'), 'Incomplete Provider');
    await user.type(screen.getByPlaceholderText('support@client.com'), 'incomplete@client.com');

    // Button should still be disabled without all required fields
    expect(submitButton).toBeDisabled();

    // Fill remaining required fields
    await user.type(screen.getByPlaceholderText('xxxxxxxxx.apps.googleusercontent.com'), 'test.apps.googleusercontent.com');
    await user.type(screen.getByPlaceholderText('Enter client secret'), 'test-secret');
    await user.type(screen.getByPlaceholderText('my-project-id'), 'test-project');
    await user.type(screen.getByPlaceholderText('gmail-notifications'), 'test-topic');
    await user.type(screen.getByPlaceholderText('gmail-webhook-subscription'), 'test-sub');

    // Now button should be enabled
    expect(submitButton).not.toBeDisabled();
  });
});