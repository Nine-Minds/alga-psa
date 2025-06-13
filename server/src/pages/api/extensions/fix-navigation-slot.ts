import { NextApiRequest, NextApiResponse } from 'next';
import { getAdminConnection } from '@/lib/db/admin';

/**
 * Fix API endpoint to update the SoftwareOne extension manifest
 * GET /api/extensions/fix-navigation-slot
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const knex = await getAdminConnection();
    
    // Get the SoftwareOne extension
    const extension = await knex('extensions')
      .where('name', 'SoftwareOne Integration')
      .first();
    
    if (!extension) {
      await knex.destroy();
      return res.status(404).json({ error: 'SoftwareOne extension not found' });
    }

    // Parse the manifest
    const manifest = typeof extension.manifest === 'string' 
      ? JSON.parse(extension.manifest) 
      : extension.manifest;

    // Fix the navigation components
    let updated = false;
    if (manifest.components) {
      manifest.components = manifest.components.map((comp: any) => {
        if (comp.type === 'navigation' && comp.id === 'swone-main-nav') {
          updated = true;
          return {
            ...comp,
            slot: 'main-nav',
            props: {
              ...comp.props,
              id: 'swone-nav',
              label: 'SoftwareOne',
              priority: 75,
              permissions: []
            }
          };
        }
        if (comp.type === 'navigation' && comp.id === 'swone-settings-nav') {
          updated = true;
          return {
            ...comp,
            slot: 'settings-nav',
            props: {
              ...comp.props,
              id: 'swone-settings-nav',
              label: 'SoftwareOne',
              priority: 70,
              permissions: ['settings:write']
            }
          };
        }
        return comp;
      });
    }

    // Add autoEnable if missing
    if (!manifest.autoEnable) {
      manifest.autoEnable = true;
      updated = true;
    }

    if (updated) {
      // Update the extension in the database
      await knex('extensions')
        .where('id', extension.id)
        .update({
          manifest: JSON.stringify(manifest),
          updated_at: new Date()
        });
    }

    await knex.destroy();

    return res.status(200).json({ 
      message: 'Extension manifest updated successfully',
      updated,
      manifest
    });
  } catch (error: any) {
    console.error('Fix navigation slot error:', error);
    return res.status(500).json({ 
      error: error.message
    });
  }
}