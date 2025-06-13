'use client';

import React, { Suspense } from 'react';
import { ExtensionRendererProps } from './types';
import { ExtensionErrorBoundary } from './ExtensionErrorBoundary';

// Create a cache for the dynamically imported components.
// The key is a unique identifier for the component, and the value is the lazy-loaded component.
const componentCache = new Map<string, React.LazyExoticComponent<React.ComponentType<any>>>();

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
  // Generate a unique cache key for the component.
  const cacheKey = `${extensionId}:${componentPath}`;

  // If the component is not already in the cache, create a lazy-loaded version and add it.
  if (!componentCache.has(cacheKey)) {
    const LazyComponent = React.lazy(() => {
        // Use a dynamic import to fetch the component from the API endpoint.
        // To prevent the Next.js bundler from trying to resolve this import at
        // build time, we construct a full, dynamic URL. This forces the import
        // to be handled entirely at runtime by the browser.
        const componentUrl = `${window.location.origin}/api/extensions/${extensionId}/components/${componentPath}`;
        // Tell webpack to ignore this import so it remains dynamic at runtime.
        return import(/* webpackIgnore: true */ /* @vite-ignore */ componentUrl)
            .catch(err => {
                // If the import fails, log the error and return a component that displays the error.
                console.error(`[ExtensionRenderer] Failed to load component: ${componentPath}`, err);
                onError?.(err);
                return { default: () => <ErrorDisplay error={err} componentPath={componentPath} /> };
            });
    });
    componentCache.set(cacheKey, LazyComponent);
  }

  // Retrieve the lazy-loaded component from the cache.
  const LazyComponent = componentCache.get(cacheKey)!;

  // Combine the default props from the extension manifest and the props from the slot.
  const combinedProps = {
    ...defaultProps,
    ...slotProps,
    extensionId,
  };

  return (
    <ExtensionErrorBoundary extensionId={extensionId} onError={onError}>
      <Suspense fallback={<Loading />}>
        {/* Render the lazy-loaded component inside a Suspense boundary. */}
        <LazyComponent {...combinedProps} />
      </Suspense>
    </ExtensionErrorBoundary>
  );
}