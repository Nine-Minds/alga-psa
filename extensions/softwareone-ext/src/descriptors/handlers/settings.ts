import { HandlerContext } from './types';

/**
 * Settings page handlers for SoftwareOne extension
 */

export async function saveApiConfig(event: Event, context: HandlerContext) {
  event.preventDefault();
  
  const form = event.target as HTMLFormElement;
  const formData = new FormData(form);
  
  const config = {
    apiEndpoint: formData.get('apiEndpoint') as string,
    apiToken: formData.get('apiToken') as string,
  };

  try {
    // Save to extension storage
    await context.extension.storage.set('softwareone/config/api', config);
    
    context.ui.toast('API configuration saved successfully', 'success');
  } catch (error) {
    console.error('Failed to save API config:', error);
    context.ui.toast('Failed to save API configuration', 'error');
  }
}

export async function saveSyncSettings(event: Event, context: HandlerContext) {
  event.preventDefault();
  
  const form = event.target as HTMLFormElement;
  const formData = new FormData(form);
  
  const settings = {
    syncInterval: parseInt(formData.get('syncInterval') as string, 10),
    autoSync: formData.get('autoSync') === 'on',
  };

  try {
    await context.extension.storage.set('softwareone/config/sync', settings);
    context.ui.toast('Sync settings saved successfully', 'success');
  } catch (error) {
    console.error('Failed to save sync settings:', error);
    context.ui.toast('Failed to save sync settings', 'error');
  }
}

export async function testConnection(event: MouseEvent, context: HandlerContext) {
  try {
    // Get API config from storage
    const config = await context.extension.storage.get('softwareone/config/api');
    
    if (!config?.apiEndpoint || !config?.apiToken) {
      context.ui.toast('Please configure API settings first', 'warning');
      return;
    }

    // Test the connection
    const response = await context.api.post('/api/extensions/softwareone/test-connection', {
      endpoint: config.apiEndpoint,
      token: config.apiToken
    });

    if (response.data.success) {
      context.ui.toast('Connection successful!', 'success');
    } else {
      context.ui.toast('Connection failed: ' + response.data.error, 'error');
    }
  } catch (error) {
    console.error('Connection test failed:', error);
    context.ui.toast('Connection test failed', 'error');
  }
}

export async function syncNow(event: MouseEvent, context: HandlerContext) {
  try {
    context.ui.toast('Starting synchronization...', 'info');
    
    // Trigger sync via API
    const response = await context.api.post('/api/extensions/softwareone/sync', {
      syncAgreements: true,
      syncStatements: true
    });

    if (response.data.success) {
      context.ui.toast(`Synchronization completed. ${response.data.agreementsCount} agreements and ${response.data.statementsCount} statements synced.`, 'success');
    } else {
      context.ui.toast('Synchronization failed: ' + response.data.error, 'error');
    }
  } catch (error) {
    console.error('Sync failed:', error);
    context.ui.toast('Synchronization failed', 'error');
  }
}

export async function openMappingDialog(event: MouseEvent, context: HandlerContext) {
  // TODO: Implement service mapping dialog
  context.ui.toast('Service mapping dialog coming soon', 'info');
}

/**
 * Load initial form data
 */
export async function loadFormData(context: HandlerContext) {
  try {
    const apiConfig = await context.extension.storage.get('softwareone/config/api');
    const syncConfig = await context.extension.storage.get('softwareone/config/sync');
    
    // Populate form fields
    if (apiConfig) {
      const apiEndpointInput = document.getElementById('apiEndpoint') as HTMLInputElement;
      const apiTokenInput = document.getElementById('apiToken') as HTMLInputElement;
      
      if (apiEndpointInput) apiEndpointInput.value = apiConfig.apiEndpoint || '';
      if (apiTokenInput) apiTokenInput.value = apiConfig.apiToken || '';
    }
    
    if (syncConfig) {
      const syncIntervalInput = document.getElementById('syncInterval') as HTMLInputElement;
      const autoSyncInput = document.getElementById('autoSync') as HTMLInputElement;
      
      if (syncIntervalInput) syncIntervalInput.value = syncConfig.syncInterval?.toString() || '6';
      if (autoSyncInput) autoSyncInput.checked = syncConfig.autoSync || false;
    }
  } catch (error) {
    console.error('Failed to load form data:', error);
  }
}