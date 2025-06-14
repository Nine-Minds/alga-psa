import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import { ExtensionRenderer } from '../ui/ExtensionRenderer';
import { useExtensions } from '../../../hooks/useExtensions';

interface ExtensionRoute {
  path: string;
  extensionId: string;
  component: string;
  slot?: string;
}

interface ExtensionRouterProps {
  basePath?: string;
}

/**
 * Handles routing for extension pages
 */
export function ExtensionRouter({ basePath = '/ext' }: ExtensionRouterProps) {
  const router = useRouter();
  const { extensions, loading: extensionsLoading } = useExtensions();
  const [currentRoute, setCurrentRoute] = useState<ExtensionRoute | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (extensionsLoading) return;

    // Extract the extension path from the URL
    const path = router.asPath;
    if (!path.startsWith(basePath)) {
      setLoading(false);
      return;
    }

    // Parse the extension route
    const extensionPath = path.substring(basePath.length);
    const [extensionId, ...pathParts] = extensionPath.split('/').filter(Boolean);

    if (!extensionId) {
      setLoading(false);
      return;
    }

    // Find the extension
    const extension = extensions.find(ext => ext.id === extensionId);
    if (!extension) {
      setLoading(false);
      return;
    }

    // Find matching route in extension manifest
    const pagePath = '/' + pathParts.join('/');
    const route = findRoute(extension.manifest, pagePath);

    if (route) {
      setCurrentRoute({
        path: pagePath,
        extensionId: extension.id,
        component: route.component,
        slot: route.slot
      });
    }

    setLoading(false);
  }, [router.asPath, extensions, extensionsLoading, basePath]);

  if (loading || extensionsLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (!currentRoute) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <h2 className="text-2xl font-bold mb-2">Page Not Found</h2>
          <p className="text-gray-500">The requested extension page could not be found.</p>
        </div>
      </div>
    );
  }

  return (
    <ExtensionRenderer
      extensionId={currentRoute.extensionId}
      component={currentRoute.component}
      slot={currentRoute.slot || 'page'}
      props={{
        route: currentRoute.path,
        params: router.query
      }}
    />
  );
}

/**
 * Find a route in the extension manifest
 */
function findRoute(manifest: any, path: string): { component: string; slot?: string } | null {
  // Check routes array
  if (manifest.routes && Array.isArray(manifest.routes)) {
    for (const route of manifest.routes) {
      if (route.path === path || matchRoute(route.path, path)) {
        return {
          component: route.component,
          slot: route.slot
        };
      }
    }
  }

  // Check components array for page slots
  if (manifest.components && Array.isArray(manifest.components)) {
    for (const component of manifest.components) {
      if (component.slot === 'page' && component.route === path) {
        return {
          component: component.component,
          slot: 'page'
        };
      }
    }
  }

  return null;
}

/**
 * Match a route pattern with parameters
 */
function matchRoute(pattern: string, path: string): boolean {
  // Simple parameter matching (e.g., /agreements/:id)
  const patternParts = pattern.split('/');
  const pathParts = path.split('/');

  if (patternParts.length !== pathParts.length) {
    return false;
  }

  for (let i = 0; i < patternParts.length; i++) {
    if (patternParts[i].startsWith(':')) {
      // Parameter placeholder
      continue;
    }
    if (patternParts[i] !== pathParts[i]) {
      return false;
    }
  }

  return true;
}