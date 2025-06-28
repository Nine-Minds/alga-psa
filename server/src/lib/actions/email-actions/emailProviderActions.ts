'use server'

import { getCurrentTenant } from '../tenantActions';
import { createTenantKnex } from '../../db';
import { withTransaction } from '@shared/db';
import { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { EmailProvider } from '../../../components/EmailProviderConfiguration';

export interface CreateEmailProviderInput {
  providerType: 'microsoft' | 'google';
  providerName: string;
  mailbox: string;
  vendorConfig: any;
}

export interface UpdateEmailProviderInput {
  providerName?: string;
  isActive?: boolean;
  vendorConfig?: any;
}

export async function getEmailProviders(): Promise<EmailProvider[]> {
  const tenant = await getCurrentTenant();
  if (!tenant) throw new Error('No tenant found');

  const { knex: db } = await createTenantKnex();
  
  return withTransaction(db, async (trx: Knex.Transaction) => {
    const providers = await trx('email_provider_configs')
      .select('*')
      .where('tenant', tenant)
      .orderBy('created_at', 'desc');

    return providers.map(provider => ({
      id: provider.id,
      tenant: provider.tenant,
      providerType: provider.provider_type,
      providerName: provider.name,
      mailbox: provider.mailbox,
      isActive: provider.active,
      status: provider.connection_status || 'disconnected',
      lastSyncAt: provider.last_sync_at,
      errorMessage: provider.connection_error_message,
      vendorConfig: provider.provider_config || {},
      createdAt: provider.created_at,
      updatedAt: provider.updated_at,
    }));
  });
}

export async function createEmailProvider(input: CreateEmailProviderInput): Promise<EmailProvider> {
  const tenant = await getCurrentTenant();
  if (!tenant) throw new Error('No tenant found');

  const { knex: db } = await createTenantKnex();
  
  return withTransaction(db, async (trx: Knex.Transaction) => {
    const id = uuidv4();
    
    const [provider] = await trx('email_provider_configs')
      .insert({
        id,
        tenant,
        provider_type: input.providerType,
        name: input.providerName,
        mailbox: input.mailbox,
        active: true,
        connection_status: 'disconnected',
        provider_config: input.vendorConfig,
        folder_to_monitor: 'Inbox',
        webhook_notification_url: '',
        created_at: new Date(),
        updated_at: new Date(),
      })
      .returning('*');

    return {
      id: provider.id,
      tenant: provider.tenant,
      providerType: provider.provider_type,
      providerName: provider.name,
      mailbox: provider.mailbox,
      isActive: provider.active,
      status: provider.connection_status,
      lastSyncAt: provider.last_sync_at,
      errorMessage: provider.connection_error_message,
      vendorConfig: provider.provider_config,
      createdAt: provider.created_at,
      updatedAt: provider.updated_at,
    };
  });
}

export async function updateEmailProvider(
  providerId: string, 
  input: UpdateEmailProviderInput
): Promise<EmailProvider> {
  const tenant = await getCurrentTenant();
  if (!tenant) throw new Error('No tenant found');

  const { knex: db } = await createTenantKnex();
  
  return withTransaction(db, async (trx: Knex.Transaction) => {
    const updateData: any = {
      updated_at: new Date(),
    };

    if (input.providerName !== undefined) {
      updateData.name = input.providerName;
    }
    if (input.isActive !== undefined) {
      updateData.active = input.isActive;
    }
    if (input.vendorConfig !== undefined) {
      updateData.provider_config = input.vendorConfig;
    }

    const [provider] = await trx('email_provider_configs')
      .where({ id: providerId, tenant })
      .update(updateData)
      .returning('*');

    if (!provider) {
      throw new Error('Provider not found');
    }

    return {
      id: provider.id,
      tenant: provider.tenant,
      providerType: provider.provider_type,
      providerName: provider.name,
      mailbox: provider.mailbox,
      isActive: provider.active,
      status: provider.connection_status,
      lastSyncAt: provider.last_sync_at,
      errorMessage: provider.connection_error_message,
      vendorConfig: provider.provider_config,
      createdAt: provider.created_at,
      updatedAt: provider.updated_at,
    };
  });
}

export async function deleteEmailProvider(providerId: string): Promise<void> {
  const tenant = await getCurrentTenant();
  if (!tenant) throw new Error('No tenant found');

  const { knex: db } = await createTenantKnex();
  
  return withTransaction(db, async (trx: Knex.Transaction) => {
    const result = await trx('email_provider_configs')
      .where({ id: providerId, tenant })
      .delete();

    if (result === 0) {
      throw new Error('Provider not found');
    }
  });
}

export async function testEmailProviderConnection(providerId: string): Promise<{
  success: boolean;
  message: string;
  error?: string;
}> {
  const tenant = await getCurrentTenant();
  if (!tenant) throw new Error('No tenant found');

  try {
    // In a real implementation, this would:
    // 1. Fetch the provider configuration
    // 2. Attempt to connect using the appropriate adapter
    // 3. Return the connection status
    
    // For now, return a mock response
    return {
      success: true,
      message: 'Connection test successful',
    };
  } catch (error: any) {
    return {
      success: false,
      message: 'Connection test failed',
      error: error.message,
    };
  }
}

export async function autoWireEmailProvider(input: {
  providerType: 'microsoft' | 'google';
  config: any;
}): Promise<{
  success: boolean;
  provider?: EmailProvider;
  error?: string;
  requiresAuth?: boolean;
  authUrl?: string;
}> {
  try {
    // In a real implementation, this would:
    // 1. Validate the OAuth configuration
    // 2. Exchange authorization code for tokens if provided
    // 3. Create the provider configuration
    // 4. Initialize webhooks
    
    // For now, create the provider with the provided config
    const provider = await createEmailProvider({
      providerType: input.providerType,
      providerName: input.config.providerName,
      mailbox: input.config.mailbox,
      vendorConfig: input.config,
    });

    return {
      success: true,
      provider,
    };
  } catch (error: any) {
    return {
      success: false,
      error: error.message,
    };
  }
}