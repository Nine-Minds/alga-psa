// This file contains the actual implementation
// It should only be imported from server-side code

export { 
  getOrCreateInstanceId,
  getAnalyticsSettings,
  updateAnalyticsPreferences,
  isAnalyticsEnabled,
  clearInstanceIdCache
} from './analyticsSettings';