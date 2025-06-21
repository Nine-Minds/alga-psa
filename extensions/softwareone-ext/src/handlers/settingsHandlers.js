/**
 * Handler functions for the Settings page
 */

// Mock API client for testing
class MockSoftwareOneClient {
  constructor(config) {
    this.config = config;
  }
  
  async testConnection() {
    // Simulate API call
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Mock validation
    if (!this.config.apiToken || this.config.apiToken.length < 10) {
      throw new Error('Invalid API token');
    }
    
    if (!this.config.apiEndpoint.startsWith('https://')) {
      throw new Error('API endpoint must use HTTPS');
    }
    
    return true;
  }
}

// Mock sync service
class MockSyncService {
  constructor(config, context) {
    this.config = config;
    this.context = context;
  }
  
  async performFullSync() {
    // Simulate sync process
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    return {
      success: true,
      message: 'Sync completed successfully',
      counts: {
        agreements: Math.floor(Math.random() * 50) + 10,
        statements: Math.floor(Math.random() * 100) + 20,
        subscriptions: Math.floor(Math.random() * 200) + 50,
        orders: Math.floor(Math.random() * 150) + 30
      },
      timestamp: new Date().toISOString()
    };
  }
}

// Form state management
let formState = {
  config: {
    apiEndpoint: 'https://api.softwareone.com',
    apiToken: '',
    syncInterval: 60,
    enableAutoSync: false
  },
  errors: {},
  testResult: null,
  syncResult: null,
  lastSync: null
};

/**
 * Handle configuration save
 */
export async function handleSaveConfiguration(event, context) {
  event.preventDefault();
  
  try {
    // Validate form
    const errors = {};
    if (!formState.config.apiEndpoint) {
      errors.apiEndpoint = 'API endpoint is required';
    } else if (!formState.config.apiEndpoint.startsWith('https://')) {
      errors.apiEndpoint = 'Must be a valid HTTPS URL';
    }
    
    if (!formState.config.apiToken) {
      errors.apiToken = 'API token is required';
    } else if (formState.config.apiToken.length < 10) {
      errors.apiToken = 'API token must be at least 10 characters';
    }
    
    if (Object.keys(errors).length > 0) {
      formState.errors = errors;
      return;
    }
    
    // Save to storage
    await context.extension.storage.set('config', formState.config);
    
    // Show success message
    context.ui.toast('Configuration saved successfully', 'success');
    formState.testResult = {
      success: true,
      message: 'Configuration saved successfully'
    };
    
  } catch (error) {
    context.ui.toast('Failed to save configuration: ' + error.message, 'error');
    formState.testResult = {
      success: false,
      message: 'Failed to save configuration: ' + error.message
    };
  }
}

/**
 * Test API connection
 */
export async function handleTestConnection(event, context) {
  formState.testResult = null;
  
  try {
    const client = new MockSoftwareOneClient(formState.config);
    await client.testConnection();
    
    formState.testResult = {
      success: true,
      message: 'Connection successful! Your API credentials are valid.'
    };
    
    context.ui.toast('Connection test successful', 'success');
    
  } catch (error) {
    formState.testResult = {
      success: false,
      message: `Connection failed: ${error.message}`
    };
    
    context.ui.toast('Connection test failed', 'error');
  }
}

/**
 * Run manual synchronization
 */
export async function handleManualSync(event, context) {
  formState.syncResult = null;
  
  try {
    const syncService = new MockSyncService(formState.config, context);
    const result = await syncService.performFullSync();
    
    formState.syncResult = result;
    
    // Save last sync info
    await context.extension.storage.set('lastSync', {
      timestamp: result.timestamp,
      counts: result.counts,
      success: result.success
    });
    
    // Update lastSync in state
    formState.lastSync = {
      timestamp: result.timestamp,
      counts: result.counts
    };
    
    context.ui.toast('Synchronization completed successfully', 'success');
    
  } catch (error) {
    formState.syncResult = {
      success: false,
      message: `Sync failed: ${error.message}`,
      errors: [error.message]
    };
    
    context.ui.toast('Synchronization failed', 'error');
  }
}

/**
 * Handle input field changes
 */
export function handleInputChange(event, context) {
  const { name, value, type } = event.target;
  
  if (type === 'number') {
    formState.config[name] = parseInt(value) || 0;
  } else {
    formState.config[name] = value;
  }
  
  // Clear error for this field
  if (formState.errors[name]) {
    delete formState.errors[name];
  }
}

/**
 * Handle checkbox changes
 */
export function handleCheckboxChange(event, context) {
  const { name, checked } = event.target;
  formState.config[name] = checked;
}

/**
 * Format date for display
 */
export function formatDate(timestamp) {
  if (!timestamp) return 'Never';
  
  try {
    return new Date(timestamp).toLocaleString();
  } catch (error) {
    return timestamp;
  }
}

/**
 * Initialize handler state from storage
 */
export async function initializeHandlers(context) {
  try {
    // Load configuration from storage
    const storedConfig = await context.extension.storage.get('config');
    if (storedConfig) {
      formState.config = { ...formState.config, ...storedConfig };
    }
    
    // Load last sync info
    const lastSync = await context.extension.storage.get('lastSync');
    if (lastSync) {
      formState.lastSync = lastSync;
    }
    
  } catch (error) {
    console.error('Failed to load settings:', error);
  }
  
  return formState;
}

// Export all handlers
export default {
  handleSaveConfiguration,
  handleTestConnection,
  handleManualSync,
  handleInputChange,
  handleCheckboxChange,
  formatDate,
  initializeHandlers
};