/**
 * Extension Provider Component
 * 
 * Provides context and state for extension components
 */
'use client';

import React, { createContext, ReactNode, useContext, useEffect, useState } from 'react';
import { ExtensionContextValue } from './types';
// import { useTenant } from '../../../hooks/useTenant';
// import { useAuth } from '../../../auth/session';
import logger from '@/utils/logger';

// Temporary fallbacks for missing hooks
const useTenant = () => ({ id: 'default-tenant' });
const useAuth = () => ({ user: { id: 'default-user', name: 'Default User', email: 'user@example.com' } });

// Create extension context
const ExtensionContext = createContext<ExtensionContextValue | null>(null);

interface ExtensionProviderProps {
  children: ReactNode;
}

/**
 * Provider component for extension context
 */
export const ExtensionProvider: React.FC<ExtensionProviderProps> = ({ children }) => {
  const tenant = useTenant();
  const { user } = useAuth();
  const [initialized, setInitialized] = useState(false);
  
  // Initialize extension system
  useEffect(() => {
    const initialize = async () => {
      try {
        // In the future, we might load extension settings, etc.
        logger.debug('Extension system initialized', { tenant: tenant?.id });
      } catch (error) {
        logger.error('Failed to initialize extension system', { error });
      } finally {
        setInitialized(true);
      }
    };
    
    if (tenant?.id) {
      initialize();
    }
  }, [tenant?.id]);
  
  // Simple permission checking
  const hasPermission = (permission: string) => {
    // For now, this is a simple placeholder
    // In the future, we'll check against actual extension permissions
    return true;
  };
  
  // Only render children once initialized
  if (!initialized && tenant?.id) {
    return <div>Loading extensions...</div>;
  }
  
  const contextValue: ExtensionContextValue = {
    tenant: {
      id: tenant?.id || '',
      name: tenant?.id || '',
    },
    user: user ? {
      id: user.id,
      name: user.name || '',
      email: user.email || '',
    } : null,
    hasPermission,
  };
  
  return (
    <ExtensionContext.Provider value={contextValue}>
      {children}
    </ExtensionContext.Provider>
  );
};

/**
 * Hook to access extension context
 */
export const useExtensionContext = () => {
  const context = useContext(ExtensionContext);
  if (!context) {
    throw new Error('useExtensionContext must be used within an ExtensionProvider');
  }
  return context;
};