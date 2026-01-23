'use server'

import { revalidatePath } from 'next/cache'
import { createTenantKnex } from '@/lib/db'
import { withTransaction } from '@alga-psa/db'
import { ExtensionRegistry } from '../extensions/registry'
import { ExtensionStorageService } from '../extensions/storage/storageService'
import logger from '@alga-psa/core/logger'
import { Extension, ExtensionManifest } from '../extensions/types'
import { Knex } from 'knex'
import { getCurrentUser } from 'server/src/lib/actions/user-actions/userActions'
import { hasPermission } from 'server/src/lib/auth/rbac'
import {
  deleteInstallSecretsRecord,
  getInstallConfig,
  upsertInstallConfigRecord,
  upsertInstallSecretsRecord,
} from '../extensions/installConfig'
import { listOrMaterializeEndpointsForVersion } from '../extensions/endpoints'
import { toggleExtensionV2, uninstallExtensionV2 } from './extRegistryV2Actions'

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

  const user = await getCurrentUser()
  if (!user) throw new Error('User not authenticated')
  if (user.user_type === 'client') throw new Error('Insufficient permissions')
  const allowed = await hasPermission(user, 'extension', 'read', knex)
  if (!allowed) throw new Error('Insufficient permissions')

  // Prefer Registry v2 installs (EE) when available, otherwise fall back to legacy extensions table.
  try {
    const rows = await knex('tenant_extension_install as ti')
      .join('extension_registry as er', 'er.id', 'ti.registry_id')
      .join('extension_version as ev', 'ev.id', 'ti.version_id')
      .where('ti.tenant_id', tenant)
      .select({
        id: 'er.id',
        tenant_id: 'ti.tenant_id',
        name: 'er.name',
        description: 'er.description',
        version: 'ev.version',
        publisher: 'er.publisher',
        is_enabled: 'ti.is_enabled',
        created_at: 'ti.created_at',
        updated_at: 'ti.updated_at',
        main_entry: 'ev.main_entry',
        api_endpoints: 'ev.api_endpoints',
      })

    return rows.map((row: any) => ({
      id: row.id,
      tenant_id: row.tenant_id,
      name: row.name,
      description: row.description ?? null,
      version: row.version,
      manifest: {
        id: row.id,
        name: row.name,
        description: row.description ?? undefined,
        version: row.version,
        main: row.main_entry ?? undefined,
        author: row.publisher ?? undefined,
        settings: [],
        api: {
          endpoints: Array.isArray(row.api_endpoints)
            ? row.api_endpoints
            : (() => {
                try {
                  return JSON.parse(row.api_endpoints || '[]')
                } catch {
                  return []
                }
              })(),
        },
      },
      is_enabled: Boolean(row.is_enabled),
      created_at: row.created_at instanceof Date ? row.created_at : new Date(row.created_at ?? Date.now()),
      updated_at: row.updated_at instanceof Date ? row.updated_at : new Date(row.updated_at ?? row.created_at ?? Date.now()),
    }))
  } catch (error: any) {
    const msg = error?.message ?? String(error)
    if (msg.toLowerCase().includes('tenant_extension_install') && msg.toLowerCase().includes('does not exist')) {
      return await withTransaction(knex, async (trx: Knex.Transaction) => {
        const registry = new ExtensionRegistry(trx)
        return await registry.getAllExtensions(tenant)
      })
    }
    throw error
  }
}

/**
 * Fetch a specific extension by ID
 */
export async function fetchExtensionById(extensionId: string): Promise<Extension | null> {
  const { knex, tenant } = await createTenantKnex()
  
  if (!tenant) {
    throw new Error('Tenant not found')
  }

  const user = await getCurrentUser()
  if (!user) throw new Error('User not authenticated')
  if (user.user_type === 'client') throw new Error('Insufficient permissions')
  const allowed = await hasPermission(user, 'extension', 'read', knex)
  if (!allowed) throw new Error('Insufficient permissions')

  // Prefer Registry v2 installs by registryId, fall back to legacy extensionId.
  try {
    const row = await knex('tenant_extension_install as ti')
      .join('extension_registry as er', 'er.id', 'ti.registry_id')
      .join('extension_version as ev', 'ev.id', 'ti.version_id')
      .where('ti.tenant_id', tenant)
      .andWhere('ti.registry_id', extensionId)
      .first({
        id: 'er.id',
        tenant_id: 'ti.tenant_id',
        name: 'er.name',
        description: 'er.description',
        version: 'ev.version',
        publisher: 'er.publisher',
        is_enabled: 'ti.is_enabled',
        created_at: 'ti.created_at',
        updated_at: 'ti.updated_at',
        main_entry: 'ev.main_entry',
        api_endpoints: 'ev.api_endpoints',
      })

    if (row) {
      const endpoints = Array.isArray((row as any).api_endpoints)
        ? (row as any).api_endpoints
        : (() => {
            try {
              return JSON.parse((row as any).api_endpoints || '[]')
            } catch {
              return []
            }
          })()

      return {
        id: row.id,
        tenant_id: row.tenant_id,
        name: row.name,
        description: row.description ?? null,
        version: row.version,
        manifest: {
          id: row.id,
          name: row.name,
          description: row.description ?? undefined,
          version: row.version,
          main: row.main_entry ?? undefined,
          author: row.publisher ?? undefined,
          settings: [],
          api: { endpoints },
        },
        is_enabled: Boolean(row.is_enabled),
        created_at: row.created_at instanceof Date ? row.created_at : new Date(row.created_at ?? Date.now()),
        updated_at: row.updated_at instanceof Date ? row.updated_at : new Date(row.updated_at ?? row.created_at ?? Date.now()),
      }
    }
  } catch (error: any) {
    const msg = error?.message ?? String(error)
    if (!(msg.toLowerCase().includes('tenant_extension_install') && msg.toLowerCase().includes('does not exist'))) {
      throw error
    }
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
  const out = await toggleExtensionV2(extensionId)
  if (!out.success) {
    return { success: false, message: out.message || 'Failed to toggle extension' }
  }
  revalidatePath('/msp/settings/extensions')
  revalidatePath(`/msp/settings/extensions/${extensionId}`)
  return { success: true, message: out.message || 'OK' }
}

/**
 * Uninstall an extension
 */
export async function uninstallExtension(extensionId: string): Promise<{ success: boolean; message: string }> {
  const out = await uninstallExtensionV2(extensionId)
  if (!out.success) {
    return { success: false, message: out.message || 'Failed to uninstall extension' }
  }
  revalidatePath('/msp/settings/extensions')
  return { success: true, message: out.message || 'OK' }
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

export interface ExtensionApiEndpointOption {
  id: string
  method: string
  path: string
  handler: string
}

/**
 * Returns the manifest-declared API endpoints for the currently-installed version of an extension.
 * Used for scheduled tasks endpoint selection.
 */
export async function getExtensionApiEndpoints(extensionId: string): Promise<ExtensionApiEndpointOption[]> {
  const user = await getCurrentUser()
  if (!user) throw new Error('User not authenticated')
  if (user.user_type === 'client') throw new Error('Insufficient permissions')

  const { knex, tenant } = await createTenantKnex()
  if (!tenant) {
    throw new Error('Tenant not found')
  }
  const allowed = await hasPermission(user, 'extension', 'read', knex)
  if (!allowed) throw new Error('Insufficient permissions')

  const installConfig = await lookupInstallConfig(tenant, extensionId)
  if (!installConfig?.versionId) {
    return []
  }

  const rows = await listOrMaterializeEndpointsForVersion(installConfig.versionId)

  // v1: only expose schedulable endpoints (no path params).
  const isSchedulablePath = (p: string) => {
    const path = String(p || '')
    return !(path.includes('/:') || path.includes(':') || path.includes('{') || path.includes('}'))
  }
  const isSchedulableMethod = (m: string) => {
    const method = String(m || '').toUpperCase()
    return method === 'GET' || method === 'POST'
  }

  return rows
    .filter((row) => isSchedulablePath(row.path) && isSchedulableMethod(row.method))
    .map((row) => ({
      id: row.id,
      method: row.method,
      path: row.path,
      handler: row.handler,
    }))
}

async function lookupInstallConfig(tenantId: string, extensionId: string) {
  try {
    return await getInstallConfig({ tenantId, extensionId })
  } catch (error) {
    logger.error('Failed to load install config', { extensionId, tenantId, error })
    return null
  }
}
