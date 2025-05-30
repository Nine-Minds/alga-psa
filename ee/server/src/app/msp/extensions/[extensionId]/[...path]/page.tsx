/**
 * Extension Custom Page Route
 * 
 * Dynamic route handler for extension custom pages
 */
'use client';

import React, { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { ExtensionProvider } from '../../../../../lib/extensions/ui/ExtensionProvider';
import { PageRenderer } from '../../../../../lib/extensions/ui/pages/PageRenderer';
import { logger } from '../../../../../utils/logger';

// Loading state component
function LoadingPage() {
  return (
    <div className="p-8 flex justify-center">
      <div className="flex flex-col items-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-500 mb-4"></div>
        <div className="text-gray-600">Loading extension page...</div>
      </div>
    </div>
  );
}

// Error state component
function ErrorPage({ error }: { error: Error }) {
  return (
    <div className="p-8 max-w-4xl mx-auto">
      <div className="bg-red-50 border border-red-200 rounded-lg p-6">
        <h2 className="text-red-700 text-xl font-medium mb-4">Extension Error</h2>
        <p className="text-red-600 mb-4">{error.message}</p>
        <div className="bg-white p-4 rounded-md overflow-auto">
          <pre className="text-sm text-gray-700 whitespace-pre-wrap">
            {error.stack}
          </pre>
        </div>
      </div>
    </div>
  );
}

/**
 * Custom Page Component
 * 
 * Renders a custom page for an extension
 */
export default function ExtensionPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const [pageData, setPageData] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  
  // Extract parameters
  const extensionId = params.extensionId as string;
  const pathSegments = Array.isArray(params.path) ? params.path : [params.path];
  const path = '/' + pathSegments.join('/');
  
  // Convert search params to object
  const searchParamsObj: Record<string, string> = {};
  if (searchParams) {
    searchParams.forEach((value, key) => {
      searchParamsObj[key] = value;
    });
  }
  
  // Fetch page data
  useEffect(() => {
    const fetchPageData = async () => {
      try {
        // In a real implementation, this would fetch from an API endpoint
        // For example: /api/extensions/${extensionId}/pages?path=${path}
        
        // For now, we'll use a placeholder implementation
        await new Promise(resolve => setTimeout(resolve, 300));
        
        // Mock data for demonstration
        const mockPage = {
          extensionId,
          component: 'CustomPage',
          props: {
            id: 'sample-page',
            path,
            title: 'Sample Extension Page',
            icon: 'FileIcon',
            permissions: ['view:pages']
          }
        };
        
        setPageData(mockPage);
        setLoading(false);
      } catch (err) {
        logger.error('Failed to fetch extension page data', {
          extensionId,
          path,
          error: err
        });
        setError(err as Error);
        setLoading(false);
      }
    };
    
    fetchPageData();
  }, [extensionId, path]);
  
  // Show loading state
  if (loading) {
    return <LoadingPage />;
  }
  
  // Show error state
  if (error || !pageData) {
    return <ErrorPage error={error || new Error('Page not found')} />;
  }
  
  // Convert path segments to URL params
  const urlParams: Record<string, string> = {};
  if (pathSegments.length > 0) {
    // If the page has defined URL parameters (like :id), match them with segments
    // For this example, we'll just provide the segments by position
    pathSegments.forEach((segment, index) => {
      urlParams[`param${index + 1}`] = segment;
    });
  }
  
  // Render the page
  return (
    <ExtensionProvider>
      <Suspense fallback={<LoadingPage />}>
        <div className="extension-page-container">
          <PageRenderer
            extensionId={pageData.extensionId}
            component={pageData.component}
            props={pageData.props}
            params={urlParams}
            searchParams={searchParamsObj}
          />
        </div>
      </Suspense>
    </ExtensionProvider>
  );
}