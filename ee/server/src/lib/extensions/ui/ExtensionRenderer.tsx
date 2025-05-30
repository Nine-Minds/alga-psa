/**
 * Extension Renderer Component
 * 
 * Handles dynamic loading of extension components
 */
'use client';

import React, { useState, useEffect, useRef } from 'react';
import { ExtensionRendererProps } from './types';
import { ExtensionErrorBoundary } from './ExtensionErrorBoundary';
import { logger } from '../../../utils/logger';

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
        
        // Dynamic import - in a real implementation, this would be fetching
        // from an API or special URL that serves the extension's JavaScript
        // For now, we'll simulate it with a timeout and placeholder component
        
        // For demonstration purposes only - would be replaced with actual loading
        await new Promise(resolve => setTimeout(resolve, 500));
        
        // In a real implementation, this would be:
        // const module = await import(`/api/extensions/${extensionId}/components/${componentPath}`);
        // const Component = module.default;
        
        // For now, create a placeholder component
        const PlaceholderComponent = (props: any) => (
          <div className="border border-dashed p-4 rounded-md bg-gray-50">
            <div className="text-sm font-medium text-gray-700 mb-2">
              Extension Component from {extensionId}
            </div>
            <div className="text-xs text-gray-500 mb-3">
              Component Path: {componentPath}
            </div>
            <div className="bg-white p-3 rounded border text-xs">
              <pre className="whitespace-pre-wrap">
                {JSON.stringify(props, null, 2)}
              </pre>
            </div>
          </div>
        );
        
        // Cache the component
        componentCache.set(cacheKey, PlaceholderComponent);
        
        if (isMounted) {
          setComponent(() => PlaceholderComponent);
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