/**
 * Extension Renderer Component
 * 
 * Handles dynamic loading of extension components
 */
'use client';

import React, { useState, useEffect, useRef } from 'react';
import { ExtensionRendererProps } from './types';
import { ExtensionErrorBoundary } from './ExtensionErrorBoundary';

// Client-side logger replacement
const logger = {
  debug: (...args: any[]) => console.debug('[ExtensionRenderer]', ...args),
  info: (...args: any[]) => console.info('[ExtensionRenderer]', ...args),
  warn: (...args: any[]) => console.warn('[ExtensionRenderer]', ...args),
  error: (...args: any[]) => console.error('[ExtensionRenderer]', ...args),
};

// Cache for loaded components
const componentCache = new Map<string, React.ComponentType<any>>();

/**
 * Loading state component
 */
const Loading = () => (
  <div className="rounded-md border border-gray-200 bg-gray-50 p-4 text-center">
    <div className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-solid border-current border-r-transparent align-[-0.125em] motion-reduce:animate-[spin_1.5s_linear_infinite]" />
    <span className="ml-2 text-sm text-gray-600">Loading extension...</span>
  </div>
);

/**
 * Renders an extension component with dynamic loading
 */
export function ExtensionRenderer({
  extensionId,
  componentPath,
  slotProps = {},
  defaultProps = {},
  onRender,
  onError,
}: ExtensionRendererProps) {
  const [Component, setComponent] = useState<React.ComponentType<any> | null>(null);
  const [loading, setLoading] = useState(true);
  const startTime = useRef(Date.now());

  // Generate a cache key for this component
  const cacheKey = `${extensionId}:${componentPath}`;

  // Combine props
  const componentProps = {
    ...defaultProps,
    ...slotProps,
    extensionId,
  };

  // Load the component dynamically
  useEffect(() => {
    let isMounted = true;
    
    async function loadComponent() {
      try {
        // Check if the component is already cached
        if (componentCache.has(cacheKey)) {
          const cachedComponent = componentCache.get(cacheKey)!;
          if (isMounted) {
            setComponent(() => cachedComponent);
            setLoading(false);
            
            // Track render time
            const loadTime = Date.now() - startTime.current;
            onRender?.(loadTime);
          }
          return;
        }
        
        // Fetch the component JavaScript from the API
        const response = await fetch(`/api/extensions/${extensionId}/components/${componentPath}`);
        
        if (!response.ok) {
          throw new Error(`Failed to load component: ${response.statusText}`);
        }
        
        const componentCode = await response.text();
        
        // Create a function that returns the component
        // This is a simplified approach - in production, you'd want more security measures
        const moduleFunction = new Function('React', 'exports', 'require', componentCode + '\nreturn exports.default || exports;');
        
        // Create a minimal module environment
        const exports: any = {};
        const require = (moduleName: string) => {
          // Provide access to commonly needed modules
          if (moduleName === 'react') return React;
          if (moduleName === '@radix-ui/react-icons') {
            // Return a mock or the actual module if available
            return {
              CloudIcon: () => React.createElement('span', {}, '☁️'),
              // Add other icons as needed
            };
          }
          throw new Error(`Module '${moduleName}' not available to extensions`);
        };
        
        // Execute the module code
        const LoadedComponent = moduleFunction(React, exports, require);
        
        // Ensure we have a valid React component
        if (!LoadedComponent || (typeof LoadedComponent !== 'function' && typeof LoadedComponent !== 'object')) {
          throw new Error('Invalid component exported from extension');
        }
        
        // Cache the component
        componentCache.set(cacheKey, LoadedComponent);
        
        if (isMounted) {
          setComponent(() => LoadedComponent);
          setLoading(false);
          
          // Track render time
          const loadTime = Date.now() - startTime.current;
          onRender?.(loadTime);
        }
      } catch (error) {
        logger.error('Failed to load extension component', {
          extensionId,
          componentPath,
          error,
        });
        
        if (isMounted) {
          setLoading(false);
          onError?.(error as Error);
        }
      }
    }
    
    loadComponent();
    
    return () => {
      isMounted = false;
    };
  }, [cacheKey, extensionId, componentPath, onRender, onError]);
  
  if (loading) {
    return <Loading />;
  }
  
  if (!Component) {
    return (
      <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800">
        Failed to load extension component
      </div>
    );
  }
  
  return (
    <ExtensionErrorBoundary 
      extensionId={extensionId}
      onError={onError}
    >
      <Component {...componentProps} />
    </ExtensionErrorBoundary>
  );
}