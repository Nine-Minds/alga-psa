import React from 'react';
import { SettingsPage } from '../pages/SettingsPage';

interface SettingsPageWrapperProps {
  extensionId: string;
  [key: string]: any;
}

/**
 * Wrapper component that adapts the SettingsPage to work with the extension system
 * This component receives props from the ExtensionRenderer and creates the context
 */
export const SettingsPageWrapper: React.FC<SettingsPageWrapperProps> = () => {
  // Create a mock context for now - in production this would come from the extension system
  const context = {
    tenant: {
      id: 'default',
      name: 'Default Tenant'
    },
    user: {
      id: 'user-1',
      email: 'user@example.com',
      permissions: []
    },
    storage: {
      get: async (key: string) => {
        // Use localStorage as a simple storage solution for now
        const data = localStorage.getItem(`swone:${key}`);
        return data ? JSON.parse(data) : null;
      },
      set: async (key: string, value: any) => {
        localStorage.setItem(`swone:${key}`, JSON.stringify(value));
      },
      delete: async (key: string) => {
        localStorage.removeItem(`swone:${key}`);
      },
      getNamespace: (namespace: string) => ({
        get: async (key: string) => {
          const data = localStorage.getItem(`${namespace}:${key}`);
          return data ? JSON.parse(data) : null;
        },
        set: async (key: string, value: any) => {
          localStorage.setItem(`${namespace}:${key}`, JSON.stringify(value));
        },
        delete: async (key: string) => {
          localStorage.removeItem(`${namespace}:${key}`);
        }
      })
    },
    api: {
      call: async (method: string, path: string, data?: any) => {
        // This would integrate with the actual API in production
        console.log('API call:', method, path, data);
        return { success: true };
      }
    },
    logger: {
      info: (message: string, data?: any) => console.log('[INFO]', message, data),
      warn: (message: string, data?: any) => console.warn('[WARN]', message, data),
      error: (message: string, error?: any) => console.error('[ERROR]', message, error)
    }
  };

  return <SettingsPage context={context} />;
};

export default SettingsPageWrapper;