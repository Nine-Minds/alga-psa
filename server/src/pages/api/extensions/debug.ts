import { NextApiRequest, NextApiResponse } from 'next';
import { createTenantKnex } from '@/lib/db';
import { withErrorHandler } from '@/middleware/errorHandler';
import { ExtensionRegistry } from '../../../../../ee/server/src/lib/extensions/registry';

/**
 * Debug endpoint to check extension state
 * GET /api/extensions/debug
 */
async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Get tenant connection
    const { knex, tenant } = await createTenantKnex();
    
    if (!tenant) {
      return res.status(400).json({ error: 'No tenant context' });
    }

    const registry = new ExtensionRegistry(knex);
    
    // Get all extensions
    const allExtensions = await registry.getAllExtensions();
    
    // Get extensions for this tenant
    const tenantExtensions = await registry.listExtensions({ tenant_id: tenant });
    
    // Find SoftwareOne extension
    const softwareOneExt = tenantExtensions.find(ext => ext.id === 'com.alga.softwareone');
    
    // Get navigation items from manifest
    let navigationItems = [];
    if (softwareOneExt?.manifest?.components) {
      navigationItems = softwareOneExt.manifest.components.filter((comp: any) => 
        comp.type === 'navigation' && comp.slot === 'main-navigation'
      );
    }
    
    const debugInfo = {
      tenant,
      allExtensionsCount: allExtensions.length,
      tenantExtensionsCount: tenantExtensions.length,
      softwareOneExtension: softwareOneExt ? {
        id: softwareOneExt.id,
        name: softwareOneExt.name,
        version: softwareOneExt.version,
        is_enabled: softwareOneExt.is_enabled,
        hasManifest: !!softwareOneExt.manifest,
        componentCount: softwareOneExt.manifest?.components?.length || 0,
        navigationItemsCount: navigationItems.length,
        navigationItems: navigationItems.map((item: any) => ({
          component: item.component,
          props: item.props
        }))
      } : null,
      allTenantExtensions: tenantExtensions.map(ext => ({
        id: ext.id,
        name: ext.name,
        is_enabled: ext.is_enabled
      }))
    };
    
    return res.status(200).json(debugInfo);
  } catch (error: any) {
    console.error('Debug endpoint error:', error);
    return res.status(500).json({ 
      error: 'Failed to get debug info',
      message: error.message,
      stack: error.stack
    });
  }
}

export default withErrorHandler(handler);