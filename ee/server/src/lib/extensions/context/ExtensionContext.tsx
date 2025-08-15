import React, { createContext, useContext, useMemo } from 'react';
import { useRouter } from 'next/router';
import { useToast } from '@/hooks/use-toast';
import { ExtensionStorageService } from '../storage/ExtensionStorageService';
import type {
  UiExtensionContext as IExtensionContext,
  NavigationService,
  ApiService,
  StorageService,
  UIService,
  UserInfo
} from '../types';

interface ExtensionContextProviderProps {
  extensionId: string;
  tenantId: string;
  user: UserInfo;
  children: React.ReactNode;
}

const ExtensionContextContext = createContext<IExtensionContext | null>(null);

/**
 * Provides the extension context to descriptor handlers
 */
export function ExtensionContextProvider({
  extensionId,
  tenantId,
  user,
  children
}: ExtensionContextProviderProps) {
  const router = useRouter();
  const { toast } = useToast();

  const context = useMemo<IExtensionContext>(() => {
    // Navigation service
    const navigation: NavigationService = {
      navigate: (path: string) => {
        // Handle both relative and absolute paths
        if (path.startsWith('/')) {
          router.push(path);
        } else {
          // Relative to current extension
          router.push(`/ext/${extensionId}/${path}`);
        }
      },
      getCurrentRoute: () => router.pathname,
      onNavigate: (callback: (path: string) => void) => {
        const handler = () => callback(router.pathname);
        router.events.on('routeChangeComplete', handler);
        return () => router.events.off('routeChangeComplete', handler);
      }
    };

    // API service
    const api: ApiService = {
      get: async (path: string, options?: any) => {
        const response = await fetch(path, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            ...options?.headers
          },
          signal: options?.signal
        });
        
        if (!response.ok) {
          throw new Error(`API error: ${response.statusText}`);
        }
        
        return response.json();
      },
      
      post: async (path: string, data?: any, options?: any) => {
        const response = await fetch(path, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...options?.headers
          },
          body: JSON.stringify(data),
          signal: options?.signal
        });
        
        if (!response.ok) {
          throw new Error(`API error: ${response.statusText}`);
        }
        
        return response.json();
      },
      
      put: async (path: string, data?: any, options?: any) => {
        const response = await fetch(path, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            ...options?.headers
          },
          body: JSON.stringify(data),
          signal: options?.signal
        });
        
        if (!response.ok) {
          throw new Error(`API error: ${response.statusText}`);
        }
        
        return response.json();
      },
      
      delete: async (path: string, options?: any) => {
        const response = await fetch(path, {
          method: 'DELETE',
          headers: {
            'Content-Type': 'application/json',
            ...options?.headers
          },
          signal: options?.signal
        });
        
        if (!response.ok) {
          throw new Error(`API error: ${response.statusText}`);
        }
        
        return response.json();
      }
    };

    // Storage service
    const storage: StorageService = {
      get: async (key: string) => {
        return ExtensionStorageService.get(extensionId, key);
      },
      
      set: async (key: string, value: any) => {
        await ExtensionStorageService.set(extensionId, key, value);
      },
      
      remove: async (key: string) => {
        await ExtensionStorageService.remove(extensionId, key);
      },
      
      clear: async () => {
        await ExtensionStorageService.clear(extensionId);
      }
    };

    // UI service
    const ui: UIService = {
      toast: (message: string, type = 'info') => {
        toast({
          title: message,
          description: '',
          variant: type === 'error' ? 'destructive' : 'default'
        });
      },
      
      confirm: async (message: string, title?: string) => {
        // For now, use browser confirm
        // TODO: Replace with custom dialog
        return window.confirm(title ? `${title}\n\n${message}` : message);
      },
      
      modal: async (content: any, options?: any) => {
        // TODO: Implement modal rendering
        console.log('Modal not yet implemented', content, options);
      }
    };

    return {
      navigation,
      api,
      storage,
      ui,
      tenantId,
      user
    };
  }, [extensionId, tenantId, user, router, toast]);

  return (
    <ExtensionContextContext.Provider value={context}>
      {children}
    </ExtensionContextContext.Provider>
  );
}

/**
 * Hook to access the extension context
 */
export function useExtensionContext(): IExtensionContext {
  const context = useContext(ExtensionContextContext);
  if (!context) {
    throw new Error('useExtensionContext must be used within ExtensionContextProvider');
  }
  return context;
}
