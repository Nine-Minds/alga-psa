// SoftwareOne Extension for Alga PSA
// Version: 0.1.0

import { ExtensionContext } from './types';

// Export all components
export { NavItem } from './components/NavItem';
export { SettingsPage } from './pages/SettingsPage';
export { AgreementsList } from './pages/AgreementsList';
export { AgreementDetail } from './pages/AgreementDetail';
export { StatementsList } from './pages/StatementsList';
export { StatementDetail } from './pages/StatementDetail';

// Export API handlers
export { handler as runSync } from './handlers/runSync';
export { handler as activateAgreement } from './handlers/activateAgreement';

// Extension initialization
export async function initialize(context: ExtensionContext) {
  const { logger, storage } = context;
  
  logger.info('SoftwareOne Extension initializing', {
    version: '0.1.0',
    tenant: context.tenant.id
  });

  // Initialize storage namespace
  const namespace = storage.getNamespace('swone');
  
  // Check if initial configuration exists
  const config = await namespace.get('config');
  if (!config) {
    logger.info('No configuration found, setting defaults');
    await namespace.set('config', {
      apiEndpoint: 'https://api.softwareone.com',
      apiToken: '',
      syncInterval: 60,
      enableAutoSync: false
    });
  }

  logger.info('SoftwareOne Extension initialized successfully');
}

// Extension metadata
export const metadata = {
  id: 'com.alga.softwareone',
  name: 'SoftwareOne Integration',
  version: '0.1.0',
  description: 'Browse and bill SoftwareOne agreements inside Alga PSA',
  author: {
    name: 'Alga Development Team',
    email: 'dev@alga.io'
  }
};