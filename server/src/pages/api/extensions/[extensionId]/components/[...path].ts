import { NextApiRequest, NextApiResponse } from 'next';
import { ExtensionRegistry } from '../../../../../../../ee/server/src/lib/extensions/registry';
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
    const extensionId = req.query.extensionId as string;
    const componentPath = (req.query.path as string[]).join('/');

    if (!extensionId || !componentPath) {
      return res.status(400).json({ error: 'Invalid request' });
    }

    // Use admin connection since we don't have auth
    const { getAdminConnection } = await import('@/lib/db/admin');
    const knex = await getAdminConnection();
    
    // For security, verify the extension exists and is enabled
    // We'll check for at least one tenant where it's enabled
    const registry = new ExtensionRegistry(knex);
    const extensions = await registry.getAllExtensions();
    const extension = extensions.find(ext => ext.id === extensionId && ext.is_enabled);
    
    if (!extension || !extension.is_enabled) {
      return res.status(404).json({ error: 'Extension not found or not enabled' });
    }

    // Handle the component path - it may include the extensions prefix
    let cleanPath = componentPath;
    if (cleanPath.startsWith('extensions/')) {
      // Remove the 'extensions/' prefix
      cleanPath = cleanPath.substring('extensions/'.length);
      // Also remove the extension directory name if it's included
      const extensionDirName = 'softwareone-ext/';
      if (cleanPath.startsWith(extensionDirName)) {
        cleanPath = cleanPath.substring(extensionDirName.length);
      }
    }

    // Construct the file path
    // When running from server directory, extensions are in ./extensions
    const extensionsDir = path.join(process.cwd(), 'extensions');
    const extensionDir = 'softwareone-ext'; // Hardcoded for now, should derive from extension ID
    const filePath = path.join(extensionsDir, extensionDir, 'dist', cleanPath);

    // Security: Ensure the path doesn't escape the extension directory
    const normalizedPath = path.normalize(filePath);
    const expectedPrefix = path.join(extensionsDir, extensionDir);
    
    if (!normalizedPath.startsWith(expectedPrefix)) {
      logger.warn('Attempted directory traversal', { extensionId, componentPath, filePath });
      return res.status(403).json({ error: 'Access denied' });
    }

    // Check if file exists
    try {
      await fs.access(filePath);
    } catch (error) {
      logger.error('Component file not found', { 
        extensionId,
        componentPath,
        cleanPath,
        filePath,
        error
      });
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
    
    logger.info('Served extension component', { 
      extensionId,
      componentPath,
      cleanPath,
      filePath
    });

    return res.status(200).send(content);
  } catch (error) {
    logger.error('Failed to serve extension component', { error });
    return res.status(500).json({ error: 'Failed to serve component' });
  }
}

// Note: This endpoint doesn't require authentication because:
// 1. Components are public JavaScript files that run client-side
// 2. We verify the extension exists in the database
// 3. We have path traversal protection
export default withErrorHandler(handler);