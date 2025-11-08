'use server'

import { revalidatePath } from 'next/cache'
import { createTenantKnex } from '@/lib/db'
import { withTransaction } from '@shared/db'
import { ExtensionRegistry } from '../extensions/registry'
import { ExtensionStorageService } from '../extensions/storage/storageService'
import logger from '@shared/core/logger'
import { Extension, ExtensionManifest } from '../extensions/types'
import { Knex } from 'knex'
import {
  deleteInstallSecretsRecord,
  getInstallConfig,
  upsertInstallConfigRecord,
  upsertInstallSecretsRecord,
} from '../extensions/installConfig'

/**
 * Server actions for extension management
 */

/**
 * Fetch all extensions for the current tenant
 */
export async function fetchExtensions(): Promise<Extension[]> {
  const { knex, tenant } = await createTenantKnex()
  
  if (!tenant) {
    throw new Error('Tenant not found')
  }
  
  return await withTransaction(knex, async (trx: Knex.Transaction) => {
    const registry = new ExtensionRegistry(trx)
    return await registry.getAllExtensions(tenant)
  })
}

/**
 * Fetch a specific extension by ID
 */
export async function fetchExtensionById(extensionId: string): Promise<Extension | null> {
  const { knex, tenant } = await createTenantKnex()
  
  if (!tenant) {
    throw new Error('Tenant not found')
  }
  
  return await withTransaction(knex, async (trx: Knex.Transaction) => {
    const registry = new ExtensionRegistry(trx)
    return await registry.getExtension(extensionId, { tenant_id: tenant })
  })
}

/**
 * Enable or disable an extension
 */
export async function toggleExtension(extensionId: string): Promise<{ success: boolean; message: string }> {
  const { knex, tenant } = await createTenantKnex()
  
  if (!tenant) {
    throw new Error('Tenant not found')
  }
  
  try {
    return await withTransaction(knex, async (trx: Knex.Transaction) => {
      const registry = new ExtensionRegistry(trx)
      const extension = await registry.getExtension(extensionId, { tenant_id: tenant })
      
      if (!extension) {
        return { success: false, message: 'Extension not found' }
      }
      
      if (extension.is_enabled) {
        await registry.disableExtension(extensionId, { tenant_id: tenant })
        logger.info('Extension disabled', { extensionId, name: extension.name })
      } else {
        await registry.enableExtension(extensionId, { tenant_id: tenant })
        logger.info('Extension enabled', { extensionId, name: extension.name })
      }
      
      // Revalidate the extensions page
      revalidatePath('/msp/settings/extensions')
      revalidatePath(`/msp/settings/extensions/${extensionId}`)
      
      return { 
        success: true, 
        message: `Extension ${extension.is_enabled ? 'disabled' : 'enabled'} successfully` 
      }
    })
  } catch (error) {
    logger.error('Failed to toggle extension', { extensionId, error })
    return { success: false, message: 'Failed to toggle extension' }
  }
}

/**
 * Uninstall an extension
 */
export async function uninstallExtension(extensionId: string): Promise<{ success: boolean; message: string }> {
  const { knex, tenant } = await createTenantKnex()
  
  if (!tenant) {
    throw new Error('Tenant not found')
  }
  
  try {
    return await withTransaction(knex, async (trx: Knex.Transaction) => {
      const registry = new ExtensionRegistry(trx)
      const extension = await registry.getExtension(extensionId, { tenant_id: tenant })
      
      if (!extension) {
        return { success: false, message: 'Extension not found' }
      }
      
      // First disable the extension if it's enabled
      if (extension.is_enabled) {
        await registry.disableExtension(extensionId, { tenant_id: tenant })
      }
      
      // Remove the extension
      await registry.uninstallExtension(extensionId, { tenant_id: tenant })
      
      logger.info('Extension uninstalled', { extensionId, name: extension.name })
      
      // Revalidate the extensions page
      revalidatePath('/msp/settings/extensions')
      
      return { success: true, message: 'Extension uninstalled successfully' }
    })
  } catch (error) {
    logger.error('Failed to uninstall extension', { extensionId, error })
    return { success: false, message: 'Failed to uninstall extension' }
  }
}

/**
 * Install an extension from uploaded file
 */
export async function installExtension(formData: FormData): Promise<{ success: boolean; message: string; extensionId?: string }> {
  const { knex, tenant } = await createTenantKnex()
  
  if (!tenant) {
    throw new Error('Tenant not found')
  }
  
  try {
    const file = formData.get('extension') as File
    if (!file) {
      return { success: false, message: 'No file provided' }
    }
    
    return await withTransaction(knex, async (trx: Knex.Transaction) => {
      // In a real implementation, this would:
      // 1. Extract and validate the extension package
      // 2. Parse the manifest
      // 3. Validate permissions and dependencies
      // 4. Store the extension files
      // 5. Register the extension
      
      // For now, we'll simulate this process
      const registry = new ExtensionRegistry(trx)
      
      // Mock manifest - in reality this would be parsed from the uploaded file
      const mockManifest: ExtensionManifest = {
        name: file.name.replace(/\.(zip|tgz|tar\.gz)$/i, ''),
        version: '1.0.0',
        description: 'Uploaded extension',
        author: 'Unknown',
        main: 'index.js',
        components: [],
        permissions: [],
        settings: []
      }
      
      const extension = await registry.registerExtension(mockManifest, {
        tenant_id: tenant
      })
      
      logger.info('Extension installed', { extensionId: extension.id, name: mockManifest.name })
      
      // Revalidate the extensions page
      revalidatePath('/msp/settings/extensions')
      
      return { 
        success: true, 
        message: 'Extension installed successfully',
        extensionId: extension.id 
      }
    })
  } catch (error) {
    logger.error('Failed to install extension', { error })
    return { success: false, message: 'Failed to install extension' }
  }
}

/**
 * Get extension settings
 */
export async function getExtensionSettings(extensionId: string): Promise<Record<string, any> | null> {
  const { knex, tenant } = await createTenantKnex()
  
  if (!tenant) {
    throw new Error('Tenant not found')
  }

  const installConfig = await lookupInstallConfig(tenant, extensionId)
  if (installConfig) {
    return installConfig.config
  }
  
  try {
    return await withTransaction(knex, async (trx: Knex.Transaction) => {
      const storageService = new ExtensionStorageService(extensionId, tenant, trx)
      const settings = await storageService.get('settings')
      return settings || {}
    })
  } catch (error) {
    logger.error('Failed to get extension settings', { extensionId, error })
    return null
  }
}

/**
 * Update extension settings
 */
export async function updateExtensionSettings(
  extensionId: string, 
  settings: Record<string, any>
): Promise<{ success: boolean; message: string }> {
  const { knex, tenant } = await createTenantKnex()
  
  if (!tenant) {
    throw new Error('Tenant not found')
  }

  const installConfig = await lookupInstallConfig(tenant, extensionId)
  if (installConfig) {
    try {
      await upsertInstallConfigRecord({
        installId: installConfig.installId,
        tenantId: tenant,
        config: settings,
        providers: installConfig.providers,
      })
      revalidatePath(`/msp/settings/extensions/${extensionId}/settings`)
      return { success: true, message: 'Settings updated successfully' }
    } catch (error) {
      logger.error('Failed to update extension install config', { extensionId, error })
      return { success: false, message: 'Failed to update settings' }
    }
  }
  
  try {
    return await withTransaction(knex, async (trx: Knex.Transaction) => {
      const registry = new ExtensionRegistry(trx)
      const extension = await registry.getExtension(extensionId, { tenant_id: tenant })
      
      if (!extension) {
        return { success: false, message: 'Extension not found' }
      }
      
      const storageService = new ExtensionStorageService(extensionId, tenant, trx)
      await storageService.set('settings', settings)
      
      logger.info('Extension settings updated', { extensionId, name: extension.name })
      
      // Revalidate the extension settings page
      revalidatePath(`/msp/settings/extensions/${extensionId}/settings`)
      
      return { success: true, message: 'Settings updated successfully' }
    })
  } catch (error) {
    logger.error('Failed to update extension settings', { extensionId, error })
    return { success: false, message: 'Failed to update settings' }
  }
}

/**
 * Reset extension settings to default
 */
export async function resetExtensionSettings(extensionId: string): Promise<{ success: boolean; message: string }> {
  const { knex, tenant } = await createTenantKnex()
  
  if (!tenant) {
    throw new Error('Tenant not found')
  }

  const installConfig = await lookupInstallConfig(tenant, extensionId)
  if (installConfig) {
    try {
      await upsertInstallConfigRecord({
        installId: installConfig.installId,
        tenantId: tenant,
        config: {},
        providers: installConfig.providers,
      })
      revalidatePath(`/msp/settings/extensions/${extensionId}/settings`)
      return { success: true, message: 'Settings reset to default' }
    } catch (error) {
      logger.error('Failed to reset extension install config', { extensionId, error })
      return { success: false, message: 'Failed to reset settings' }
    }
  }
  
  try {
    return await withTransaction(knex, async (trx: Knex.Transaction) => {
      const registry = new ExtensionRegistry(trx)
      const extension = await registry.getExtension(extensionId, { tenant_id: tenant })
      
      if (!extension) {
        return { success: false, message: 'Extension not found' }
      }
      
      const storageService = new ExtensionStorageService(extensionId, tenant, trx)
      await storageService.delete('settings')
      
      logger.info('Extension settings reset', { extensionId, name: extension.name })
      
      // Revalidate the extension settings page
      revalidatePath(`/msp/settings/extensions/${extensionId}/settings`)
      
      return { success: true, message: 'Settings reset to default' }
    })
  } catch (error) {
    logger.error('Failed to reset extension settings', { extensionId, error })
    return { success: false, message: 'Failed to reset settings' }
  }
}

export interface ExtensionSecretsMetadata {
  installId: string
  secretsVersion?: string | null
  hasEnvelope: boolean
}

export async function getExtensionSecretsMetadata(extensionId: string): Promise<ExtensionSecretsMetadata | null> {
  const { tenant } = await createTenantKnex()
  if (!tenant) {
    throw new Error('Tenant not found')
  }

  const installConfig = await lookupInstallConfig(tenant, extensionId)
  if (!installConfig) {
    return null
  }

  return {
    installId: installConfig.installId,
    secretsVersion: installConfig.secretsVersion ?? null,
    hasEnvelope: Boolean(installConfig.secretEnvelope),
  }
}

export async function updateExtensionSecrets(
  extensionId: string,
  secrets: Record<string, string>,
  options?: { clear?: boolean; expiresAt?: Date | string | null }
): Promise<{ success: boolean; message: string }> {
  const { tenant } = await createTenantKnex()
  if (!tenant) {
    throw new Error('Tenant not found')
  }

  const installConfig = await lookupInstallConfig(tenant, extensionId)
  if (!installConfig) {
    return { success: false, message: 'Extension install not found' }
  }

  try {
    if (options?.clear) {
      await deleteInstallSecretsRecord({ installId: installConfig.installId })
      revalidatePath(`/msp/settings/extensions/${extensionId}/settings`)
      return { success: true, message: 'Secrets cleared successfully' }
    }

    const entries = Object.entries(secrets).reduce<Record<string, string>>((acc, [key, value]) => {
      if (typeof value === 'string' && value.length > 0) {
        acc[key] = value
      }
      return acc
    }, {})

    if (Object.keys(entries).length === 0) {
      return { success: true, message: 'No secret changes detected' }
    }

    await upsertInstallSecretsRecord({
      installId: installConfig.installId,
      tenantId: tenant,
      secrets: entries,
      expiresAt: options?.expiresAt ?? null,
    })

    revalidatePath(`/msp/settings/extensions/${extensionId}/settings`)
    return { success: true, message: 'Secrets updated successfully' }
  } catch (error) {
    logger.error('Failed to update extension secrets', { extensionId, error })
    return { success: false, message: 'Failed to update secrets' }
  }
}

async function lookupInstallConfig(tenantId: string, extensionId: string) {
  try {
    return await getInstallConfig({ tenantId, extensionId })
  } catch (error) {
    logger.error('Failed to load install config', { extensionId, tenantId, error })
    return null
  }
}
