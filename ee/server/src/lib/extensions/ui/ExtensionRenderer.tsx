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
  const [descriptor, setDescriptor] = useState<UIDescriptor | PageDescriptor | null>(null);
  const [handlers, setHandlers] = useState<Record<string, Function>>({});
  const [isDescriptor, setIsDescriptor] = useState<boolean | null>(null);

  // Check if the component path is a descriptor (ends with .json or has descriptor in the path)
  useEffect(() => {
    const checkIfDescriptor = async () => {
      // First, try to detect by file extension
      if (componentPath.endsWith('.json') || componentPath.includes('/descriptors/')) {
        setIsDescriptor(true);
        return;
      }

      // Try to load as descriptor first
      try {
        const descriptorUrl = `${window.location.origin}/api/extensions/${extensionId}/components/${componentPath}`;
        const response = await fetch(descriptorUrl);
        const contentType = response.headers.get('content-type');
        
        if (contentType?.includes('application/json')) {
          const data = await response.json();
          // Check if it has descriptor structure
          if (data.type && (typeof data.type === 'string')) {
            setIsDescriptor(true);
            setDescriptor(data);
            
            // Load handlers if specified
            if (data.handlers?.module) {
              const handlersUrl = `${window.location.origin}/api/extensions/${extensionId}/components/${data.handlers.module}`;
              const handlerModule = await import(/* webpackIgnore: true */ /* @vite-ignore */ handlersUrl);
              setHandlers(handlerModule.default || handlerModule);
            }
            return;
          }
        }
      } catch (err) {
        // Not a descriptor, fall back to component loading
      }
      
      setIsDescriptor(false);
    };

    checkIfDescriptor();
  }, [extensionId, componentPath]);

  // If it's a descriptor, render with DescriptorRenderer
  if (isDescriptor === true) {
    const context = {
      extension: {
        id: extensionId,
        version: '1.0.0', // TODO: Get from manifest
        storage: {
          get: async (key: string) => Promise.resolve(null),
          set: async (key: string, value: any) => Promise.resolve(),
          delete: async (key: string) => Promise.resolve(),
          list: async (prefix?: string) => Promise.resolve([])
        }
      },
      user: {
        id: '', // TODO: Get from context
        tenantId: '', // TODO: Get from context
        permissions: [] // TODO: Get from context
      }
    };

    if (!descriptor) {
      return <Loading />;
    }

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
  if (isDescriptor === null) {
    return <Loading />;
  }

  // Otherwise, use the existing component loading logic
  const cacheKey = `${extensionId}:${componentPath}`;

  if (!componentCache.has(cacheKey)) {
    const LazyComponent = React.lazy(() => {
        const componentUrl = `${window.location.origin}/api/extensions/${extensionId}/components/${componentPath}`;
        return import(/* webpackIgnore: true */ /* @vite-ignore */ componentUrl)
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

  return (
    <ExtensionErrorBoundary extensionId={extensionId} onError={onError}>
      <Suspense fallback={<Loading />}>
        <LazyComponent {...combinedProps} />
      </Suspense>
    </ExtensionErrorBoundary>
  );
}