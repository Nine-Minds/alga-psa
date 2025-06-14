'use client';

import React, { Suspense, useState, useEffect } from 'react';
import { ExtensionRendererProps } from './types';
import { ExtensionErrorBoundary } from './ExtensionErrorBoundary';
import { DescriptorRenderer } from './DescriptorRenderer';
import { UIDescriptor, PageDescriptor } from './descriptors/types';

// Create a cache for the dynamically imported components and descriptors.
const componentCache = new Map<string, React.LazyExoticComponent<React.ComponentType<any>>>();
const descriptorCache = new Map<string, Promise<UIDescriptor | PageDescriptor>>();
const handlerCache = new Map<string, Promise<Record<string, Function>>>();

// A simple loading component to show while the extension component is being fetched.
const Loading = () => (
  <div className="p-4 text-center text-gray-500">Loading Extension...</div>
);

// A component to display when the extension component fails to load.
const ErrorDisplay = ({ error, componentPath }: { error: any; componentPath: string }) => (
    <div className="p-4 text-red-700 bg-red-100 border border-red-300 rounded-md">
        <p className="font-semibold">Error loading component</p>
        <p className="text-sm">Could not load <code className="text-xs bg-red-200 p-1 rounded">{componentPath}</code>.</p>
        <pre className="mt-2 text-xs text-red-600 bg-red-50 p-2 rounded">{error.toString()}</pre>
    </div>
);

export function ExtensionRenderer({
  extensionId,
  componentPath,
  slotProps = {},
  defaultProps = {},
  onError,
}: ExtensionRendererProps) {
  console.log(`[ExtensionRenderer] INIT - extensionId: ${extensionId}, componentPath: ${componentPath}`);
  console.log(`[ExtensionRenderer] INIT - slotProps:`, slotProps);
  
  const [descriptor, setDescriptor] = useState<UIDescriptor | PageDescriptor | null>(null);
  const [handlers, setHandlers] = useState<Record<string, Function>>({});
  const [isDescriptor, setIsDescriptor] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);

  // Check if the component path is a descriptor (ends with .json or has descriptor in the path)
  useEffect(() => {
    const checkIfDescriptor = async () => {
      console.log(`[ExtensionRenderer] Checking component: ${componentPath} for extension: ${extensionId}`);
      console.log(`[ExtensionRenderer] Current loading state: ${loading}, isDescriptor: ${isDescriptor}`);
      
      let shouldLoadAsDescriptor = false;
      
      // First, try to detect by file extension
      if (componentPath.endsWith('.json') || componentPath.includes('/descriptors/')) {
        console.log(`[ExtensionRenderer] Detected as descriptor by path: ${componentPath}`);
        shouldLoadAsDescriptor = true;
      }

      // Try to load as descriptor if we think it might be one
      if (shouldLoadAsDescriptor || isDescriptor === null) {
        try {
          // For development, load directly from extension dist directory
          const descriptorUrl = `/extensions/${extensionId}/dist/${componentPath}`;
          console.log(`[ExtensionRenderer] Attempting to load from: ${descriptorUrl}`);
          
          const response = await fetch(descriptorUrl);
          console.log(`[ExtensionRenderer] Response status: ${response.status}`);
          console.log(`[ExtensionRenderer] Response OK: ${response.ok}`);
          
          if (!response.ok) {
            const errorText = await response.text();
            console.error(`[ExtensionRenderer] Failed to load descriptor: ${response.status} - ${errorText}`);
            throw new Error(`Failed to load descriptor: ${response.status}`);
          }
          
          const contentType = response.headers.get('content-type');
          console.log(`[ExtensionRenderer] Content-Type: ${contentType}`);
          
          if (contentType?.includes('application/json')) {
            const data = await response.json();
            console.log(`[ExtensionRenderer] Loaded JSON data:`, data);
            
            // Check if it has descriptor structure
            if (data.type && (typeof data.type === 'string')) {
              console.log(`[ExtensionRenderer] Valid descriptor detected with type: ${data.type}`);
              setIsDescriptor(true);
              setDescriptor(data);
              
              // Load handlers if specified
              if (data.handlers?.module) {
                console.log(`[ExtensionRenderer] Loading handlers from: ${data.handlers.module}`);
                const handlersUrl = `/extensions/${extensionId}/dist/${data.handlers.module}`;
                try {
                  const handlerModule = await import(/* webpackIgnore: true */ /* @vite-ignore */ handlersUrl);
                  console.log(`[ExtensionRenderer] Handlers loaded:`, handlerModule);
                  setHandlers(handlerModule.default || handlerModule);
                } catch (handlerErr) {
                  console.error(`[ExtensionRenderer] Failed to load handlers:`, handlerErr);
                }
              }
              console.log(`[ExtensionRenderer] Descriptor loading complete`);
              setLoading(false);  // Set loading to false here
              return;
            } else {
              console.error(`[ExtensionRenderer] JSON data does not have descriptor structure:`, data);
              if (shouldLoadAsDescriptor) {
                setIsDescriptor(true);
                setDescriptor(null);
                setLoading(false);
                return;
              }
            }
          } else {
            console.error(`[ExtensionRenderer] Unexpected content type: ${contentType}`);
            if (shouldLoadAsDescriptor) {
              setIsDescriptor(true);
              setDescriptor(null);
              setLoading(false);
              return;
            }
          }
        } catch (err) {
          console.error(`[ExtensionRenderer] Error loading descriptor:`, err);
          // For descriptors detected by path, we should set an error state
          if (componentPath.endsWith('.json') || componentPath.includes('/descriptors/')) {
            setIsDescriptor(true);
            // Set empty descriptor to show error
            setDescriptor(null);
            setLoading(false);  // Set loading to false on error
            return;
          }
        }
      }
      
      // Only set as non-descriptor if we haven't already determined it's a descriptor
      if (isDescriptor === null) {
        console.log(`[ExtensionRenderer] Not a descriptor, treating as component`);
        setIsDescriptor(false);
      }
      
      setLoading(false);
    };

    checkIfDescriptor();
  }, [extensionId, componentPath]);

  // If it's a descriptor, render with DescriptorRenderer
  if (isDescriptor === true) {
    console.log(`[ExtensionRenderer] Rendering descriptor`);
    
    const context = {
      extension: {
        id: extensionId,
        version: '1.0.0', // TODO: Get from manifest
        storage: {
          get: async (key: string) => {
            console.log(`[ExtensionRenderer] Storage.get called with key: ${key}`);
            return Promise.resolve(null);
          },
          set: async (key: string, value: any) => {
            console.log(`[ExtensionRenderer] Storage.set called with key: ${key}`, value);
            return Promise.resolve();
          },
          delete: async (key: string) => {
            console.log(`[ExtensionRenderer] Storage.delete called with key: ${key}`);
            return Promise.resolve();
          },
          list: async (prefix?: string) => {
            console.log(`[ExtensionRenderer] Storage.list called with prefix: ${prefix}`);
            return Promise.resolve([]);
          }
        }
      },
      user: {
        id: '', // TODO: Get from context
        tenantId: '', // TODO: Get from context
        permissions: [] // TODO: Get from context
      }
    };

    if (loading || !descriptor) {
      console.log(`[ExtensionRenderer] Loading or no descriptor yet, showing loading...`);
      return <Loading />;
    }
    
    // Check if descriptor failed to load (null after load attempt)
    if (descriptor === null) {
      console.error(`[ExtensionRenderer] Descriptor failed to load for: ${componentPath}`);
      return <ErrorDisplay error={new Error('Failed to load descriptor')} componentPath={componentPath} />;
    }

    console.log(`[ExtensionRenderer] Rendering DescriptorRenderer with descriptor:`, descriptor);
    console.log(`[ExtensionRenderer] Props:`, { ...defaultProps, ...slotProps });
    console.log(`[ExtensionRenderer] Handlers:`, handlers);

    return (
      <ExtensionErrorBoundary extensionId={extensionId} onError={onError}>
        <DescriptorRenderer
          descriptor={descriptor}
          handlers={handlers}
          context={context}
          data={{ ...defaultProps, ...slotProps }}
        />
      </ExtensionErrorBoundary>
    );
  }

  // If it's still being determined, show loading
  if (isDescriptor === null || loading) {
    console.log(`[ExtensionRenderer] Still determining if descriptor or component... loading=${loading}, isDescriptor=${isDescriptor}`);
    return <Loading />;
  }

  // Otherwise, use the existing component loading logic
  console.log(`[ExtensionRenderer] Loading as regular component: ${componentPath}`);
  const cacheKey = `${extensionId}:${componentPath}`;

  if (!componentCache.has(cacheKey)) {
    console.log(`[ExtensionRenderer] Creating lazy component for: ${componentPath}`);
    const LazyComponent = React.lazy(() => {
        const componentUrl = `${window.location.origin}/api/extensions/${extensionId}/components/${componentPath}`;
        console.log(`[ExtensionRenderer] Loading component from: ${componentUrl}`);
        return import(/* webpackIgnore: true */ /* @vite-ignore */ componentUrl)
            .then(module => {
                console.log(`[ExtensionRenderer] Component loaded successfully:`, module);
                return module;
            })
            .catch(err => {
                console.error(`[ExtensionRenderer] Failed to load component: ${componentPath}`, err);
                onError?.(err);
                return { default: () => <ErrorDisplay error={err} componentPath={componentPath} /> };
            });
    });
    componentCache.set(cacheKey, LazyComponent);
  }

  const LazyComponent = componentCache.get(cacheKey)!;

  const combinedProps = {
    ...defaultProps,
    ...slotProps,
    extensionId,
  };

  console.log(`[ExtensionRenderer] Rendering component with props:`, combinedProps);

  return (
    <ExtensionErrorBoundary extensionId={extensionId} onError={onError}>
      <Suspense fallback={<Loading />}>
        <LazyComponent {...combinedProps} />
      </Suspense>
    </ExtensionErrorBoundary>
  );
}