import { NextApiRequest, NextApiResponse } from 'next';
import { getAdminConnection } from '@/lib/db/admin';
import { ExtensionRegistry } from '../../../../../../../ee/server/src/lib/extensions/registry';
import logger from '@shared/core/logger';
import fs from 'fs/promises';
import path from 'path';

/**
 * Public API endpoint to serve extension component files
 * GET /api/extensions/[extensionId]/public-components/[...path]
 * 
 * This endpoint doesn't require authentication as components need to be loaded on the client side
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const extensionId = req.query.extensionId as string;
    const componentPath = (req.query.path as string[]).join('/');

    if (!extensionId || !componentPath) {
      return res.status(400).json({ error: 'Invalid request' });
    }

    // Use admin connection
    const knex = await getAdminConnection();
    
    // For now, we'll trust any extension ID that matches our pattern
    // In production, you'd want to verify against a whitelist
    if (!extensionId.match(/^[a-f0-9-]+$/)) {
      return res.status(400).json({ error: 'Invalid extension ID format' });
    }

    // Strip the leading /extensions/softwareone-ext/ if present
    let cleanPath = componentPath;
    if (cleanPath.startsWith('extensions/softwareone-ext/')) {
      cleanPath = cleanPath.substring('extensions/softwareone-ext/'.length);
    }

    // Construct the file path
    const extensionsDir = path.join(process.cwd(), 'extensions', 'softwareone-ext');
    const filePath = path.join(extensionsDir, cleanPath);

    // Security: Ensure the path doesn't escape the extension directory
    const normalizedPath = path.normalize(filePath);
    const expectedPrefix = extensionsDir;
    
    if (!normalizedPath.startsWith(expectedPrefix)) {
      logger.warn('Attempted directory traversal', { extensionId, componentPath, filePath });
      return res.status(403).json({ error: 'Access denied' });
    }

    // Check if file exists
    try {
      await fs.access(filePath);
    } catch {
      logger.error('Component file not found', { filePath, cleanPath });
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
    
    logger.debug('Served extension component (public)', { 
      extensionId,
      componentPath,
      cleanPath
    });

    return res.status(200).send(content);
  } catch (error) {
    logger.error('Failed to serve extension component', { error });
    return res.status(500).json({ error: 'Failed to serve component' });
  }
}