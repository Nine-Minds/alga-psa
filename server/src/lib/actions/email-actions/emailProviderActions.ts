'use server'

import { createTenantKnex } from '../../db';
import { getCurrentUser } from '../user-actions/userActions';
import type { EmailProvider } from '../../../components/EmailProviderConfiguration';

export async function getEmailProviders(): Promise<{ providers: EmailProvider[] }> {
  const user = await getCurrentUser();
  if (!user) {
    throw new Error('User not authenticated');
  }

  const { knex, tenant } = await createTenantKnex();
  
  try {
    const providers = await knex('email_providers')
      .where({ tenant })
      .orderBy('created_at', 'desc')
      .select(
        'id',
        'tenant',
        'provider_type as providerType',
        'provider_name as providerName',
        'mailbox',
        'is_active as isActive',
        'status',
        'last_sync_at as lastSyncAt',
        'error_message as errorMessage',
        'vendor_config as vendorConfig',
        'created_at as createdAt',
        'updated_at as updatedAt'
      );

    return { providers };
  } catch (error) {
    console.error('Failed to load email providers:', error);
    // Return empty array if table doesn't exist yet
    return { providers: [] };
  }
}

export async function createEmailProvider(data: {
  tenant: string;
  providerType: string;
  providerName: string;
  mailbox: string;
  isActive: boolean;
  vendorConfig: any;
}): Promise<{ provider: EmailProvider }> {
  const user = await getCurrentUser();
  if (!user) {
    throw new Error('User not authenticated');
  }

  const { knex, tenant } = await createTenantKnex();
  
  try {
    const [provider] = await knex('email_providers')
      .insert({
        id: knex.raw('gen_random_uuid()'),
        tenant,
        provider_type: data.providerType,
        provider_name: data.providerName,
        mailbox: data.mailbox,
        is_active: data.isActive,
        vendor_config: data.vendorConfig,
        status: 'configuring',
        created_at: knex.fn.now(),
        updated_at: knex.fn.now()
      })
      .returning([
        'id',
        'tenant',
        'provider_type as providerType',
        'provider_name as providerName',
        'mailbox',
        'is_active as isActive',
        'status',
        'last_sync_at as lastSyncAt',
        'error_message as errorMessage',
        'vendor_config as vendorConfig',
        'created_at as createdAt',
        'updated_at as updatedAt'
      ]);

    return { provider };
  } catch (error) {
    console.error('Failed to create email provider:', error);
    throw new Error('Failed to create email provider');
  }
}

export async function updateEmailProvider(
  providerId: string,
  data: {
    tenant: string;
    providerType: string;
    providerName: string;
    mailbox: string;
    isActive: boolean;
    vendorConfig: any;
  }
): Promise<{ provider: EmailProvider }> {
  const user = await getCurrentUser();
  if (!user) {
    throw new Error('User not authenticated');
  }

  const { knex, tenant } = await createTenantKnex();
  
  try {
    const [provider] = await knex('email_providers')
      .where({ id: providerId, tenant })
      .update({
        provider_type: data.providerType,
        provider_name: data.providerName,
        mailbox: data.mailbox,
        is_active: data.isActive,
        vendor_config: data.vendorConfig,
        updated_at: knex.fn.now()
      })
      .returning([
        'id',
        'tenant',
        'provider_type as providerType',
        'provider_name as providerName',
        'mailbox',
        'is_active as isActive',
        'status',
        'last_sync_at as lastSyncAt',
        'error_message as errorMessage',
        'vendor_config as vendorConfig',
        'created_at as createdAt',
        'updated_at as updatedAt'
      ]);

    if (!provider) {
      throw new Error('Provider not found');
    }

    return { provider };
  } catch (error) {
    console.error('Failed to update email provider:', error);
    throw new Error('Failed to update email provider');
  }
}

export async function deleteEmailProvider(providerId: string): Promise<void> {
  const user = await getCurrentUser();
  if (!user) {
    throw new Error('User not authenticated');
  }

  const { knex, tenant } = await createTenantKnex();
  
  try {
    const result = await knex('email_providers')
      .where({ id: providerId, tenant })
      .delete();

    if (result === 0) {
      throw new Error('Provider not found');
    }
  } catch (error) {
    console.error('Failed to delete email provider:', error);
    throw new Error('Failed to delete email provider');
  }
}

export async function testEmailProviderConnection(providerId: string): Promise<{ success: boolean; error?: string }> {
  const user = await getCurrentUser();
  if (!user) {
    throw new Error('User not authenticated');
  }

  const { knex, tenant } = await createTenantKnex();
  
  try {
    const provider = await knex('email_providers')
      .where({ id: providerId, tenant })
      .first();

    if (!provider) {
      throw new Error('Provider not found');
    }

    // TODO: Implement actual connection testing logic based on provider type
    // For now, we'll simulate a successful test
    await knex('email_providers')
      .where({ id: providerId })
      .update({
        status: 'connected',
        updated_at: knex.fn.now()
      });

    return { success: true };
  } catch (error) {
    console.error('Connection test failed:', error);
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Connection test failed' 
    };
  }
}

export async function setupPubSub(data: {
  projectId: string;
  topicName: string;
  subscriptionName: string;
  webhookUrl: string;
}): Promise<void> {
  const user = await getCurrentUser();
  if (!user) {
    throw new Error('User not authenticated');
  }

  // TODO: Implement actual Pub/Sub setup logic
  // This would involve calling Google Cloud APIs to create topic and subscription
  
  // For now, we'll just validate the input
  if (!data.projectId || !data.topicName || !data.subscriptionName || !data.webhookUrl) {
    throw new Error('Missing required fields for Pub/Sub setup');
  }

  // Simulate successful setup
  return;
}