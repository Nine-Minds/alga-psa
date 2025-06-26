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
import logger from 'server/src/utils/logger';

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
        
        // Map URL paths to descriptor files
        const pathMappings: Record<string, { component: string; title: string }> = {
          '/agreements': {
            component: 'descriptors/pages/AgreementsList.json',
            title: 'SoftwareOne Agreements'
          },
          '/statements': {
            component: 'descriptors/pages/StatementsList.json', 
            title: 'SoftwareOne Statements'
          },
          '/settings': {
            component: 'descriptors/pages/SettingsPage.json',
            title: 'SoftwareOne Settings'
          }
        };
        
        // Check if path matches agreement detail pattern (/agreements/:id)
        if (pathSegments[0] === 'agreements' && pathSegments[1]) {
          const mockPage = {
            extensionId,
            component: 'descriptors/pages/AgreementDetail.json',
            props: {
              id: 'agreement-detail-page',
              path,
              title: 'Agreement Details',
              agreementId: pathSegments[1],
              permissions: ['view:agreements']
            }
          };
          setPageData(mockPage);
          setLoading(false);
          return;
        }
        
        // Check if path matches statement detail pattern (/statements/:id) 
        if (pathSegments[0] === 'statements' && pathSegments[1]) {
          const mockPage = {
            extensionId,
            component: 'descriptors/pages/StatementDetail.json',
            props: {
              id: 'statement-detail-page', 
              path,
              title: 'Statement Details',
              statementId: pathSegments[1],
              permissions: ['view:statements']
            }
          };
          setPageData(mockPage);
          setLoading(false);
          return;
        }
        
        // Handle standard path mappings
        const mapping = pathMappings[path];
        if (!mapping) {
          throw new Error(`No descriptor mapping found for path: ${path}`);
        }
        
        const mockPage = {
          extensionId,
          component: mapping.component,
          props: {
            id: `${extensionId}-${pathSegments.join('-')}-page`,
            path,
            title: mapping.title,
            permissions: ['view:extensions']
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
  
  // Render the page within the DefaultLayout structure
  return (
    <ExtensionProvider>
      <Suspense fallback={<LoadingPage />}>
        <div className="p-4 md:p-6">
          {/* Breadcrumbs */}
          <nav className="mb-4">
            <ol className="flex flex-wrap items-center text-sm text-gray-500">
              <li>
                <a href="/msp/dashboard" className="hover:text-primary-600">
                  Dashboard
                </a>
              </li>
              <li className="mx-2">
                <span className="text-gray-400">›</span>
              </li>
              <li>
                <a href="/msp/extensions" className="hover:text-primary-600">
                  Extensions
                </a>
              </li>
              <li className="mx-2">
                <span className="text-gray-400">›</span>
              </li>
              <li>
                <span className="font-medium text-gray-900">
                  {extensionId.split('-').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')}
                </span>
              </li>
              {pathSegments.map((segment, index) => (
                <React.Fragment key={index}>
                  <li className="mx-2">
                    <span className="text-gray-400">›</span>
                  </li>
                  <li>
                    <span className={index === pathSegments.length - 1 ? 'font-medium text-gray-900' : 'text-gray-500'}>
                      {segment.charAt(0).toUpperCase() + segment.slice(1).replace(/-/g, ' ')}
                    </span>
                  </li>
                </React.Fragment>
              ))}
            </ol>
          </nav>
          
          {/* Extension content */}
          <div className="bg-white rounded-lg shadow-sm overflow-hidden">
            <PageRenderer
              extensionId={pageData.extensionId}
              component={pageData.component}
              props={pageData.props}
              params={urlParams}
              searchParams={searchParamsObj}
            />
          </div>
        </div>
      </Suspense>
    </ExtensionProvider>
  );
}