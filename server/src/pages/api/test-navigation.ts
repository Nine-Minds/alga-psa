import { NextApiRequest, NextApiResponse } from 'next';
import { getExtensionNavigationItems } from '@/lib/actions/extension-actions';
import { withErrorHandler } from '@/middleware/errorHandler';

/**
 * Test endpoint to directly call getExtensionNavigationItems
 * GET /api/test-navigation
 */
async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    console.log('[Test Navigation API] Starting test...');
    
    // Call the server action directly
    const navigationItems = await getExtensionNavigationItems();
    
    console.log('[Test Navigation API] Navigation items:', navigationItems);
    
    return res.status(200).json({
      success: true,
      count: navigationItems.length,
      items: navigationItems,
      timestamp: new Date().toISOString()
    });
  } catch (error: any) {
    console.error('[Test Navigation API] Error:', error);
    return res.status(500).json({ 
      success: false,
      error: 'Failed to get navigation items',
      message: error.message,
      stack: error.stack
    });
  }
}

export default withErrorHandler(handler);