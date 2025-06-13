import { NextApiRequest, NextApiResponse } from 'next';
import { createTenantKnex } from '@/lib/db';
import { ExtensionRegistry } from '../../../../../../../ee/server/src/lib/extensions/registry';
import { withAuth } from '@/middleware/auth';
import { withErrorHandler } from '@/middleware/errorHandler';
import logger from '@shared/core/logger';
import fs from 'fs/promises';
import path from 'path';

/**
 * API endpoint to serve extension component files
 * GET /api/extensions/[extensionId]/components/[...path]
 * 
 * Example: /api/extensions/com.alga.softwareone/components/dist/components/NavItem.js
 */
async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { knex, tenant } = await createTenantKnex();
    
    if (!tenant) {
      return res.status(400).json({ error: 'Tenant not found' });
    }

    const extensionId = req.query.extensionId as string;
    const componentPath = (req.query.path as string[]).join('/');

    if (!extensionId || !componentPath) {
      return res.status(400).json({ error: 'Invalid request' });
    }

    // Verify the extension exists and is enabled for this tenant
    const registry = new ExtensionRegistry(knex);
    const extension = await registry.getExtension(extensionId, { tenant_id: tenant });
    
    if (!extension || !extension.is_enabled) {
      return res.status(404).json({ error: 'Extension not found or not enabled' });
    }

    // Construct the file path
    const extensionsDir = path.join(process.cwd(), 'extensions');
    const filePath = path.join(extensionsDir, extensionId.replace('com.alga.', ''), componentPath);

    // Security: Ensure the path doesn't escape the extension directory
    const normalizedPath = path.normalize(filePath);
    const expectedPrefix = path.join(extensionsDir, extensionId.replace('com.alga.', ''));
    
    if (!normalizedPath.startsWith(expectedPrefix)) {
      logger.warn('Attempted directory traversal', { extensionId, componentPath, filePath });
      return res.status(403).json({ error: 'Access denied' });
    }

    // Check if file exists
    try {
      await fs.access(filePath);
    } catch {
      return res.status(404).json({ error: 'Component not found' });
    }

    // Read and serve the file
    const content = await fs.readFile(filePath, 'utf-8');
    
    // Set appropriate content type
    let contentType = 'application/javascript';
    if (filePath.endsWith('.css')) {
      contentType = 'text/css';
    } else if (filePath.endsWith('.json')) {
      contentType = 'application/json';
    }

    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=3600'); // Cache for 1 hour
    
    logger.debug('Served extension component', { 
      tenant,
      extensionId,
      componentPath
    });

    return res.status(200).send(content);
  } catch (error) {
    logger.error('Failed to serve extension component', { error });
    return res.status(500).json({ error: 'Failed to serve component' });
  }
}

export default withAuth(withErrorHandler(handler));