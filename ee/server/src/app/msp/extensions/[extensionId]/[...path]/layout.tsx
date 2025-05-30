/**
 * Extension Page Layout
 * 
 * Layout for extension custom pages
 */
'use client';

import React from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ChevronRight } from 'lucide-react';

/**
 * Layout for extension custom pages
 * 
 * Provides a consistent layout for extension pages,
 * including breadcrumbs and a standardized container
 */
export default function ExtensionPageLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const params = useParams();
  const extensionId = params.extensionId as string;
  const pathSegments = Array.isArray(params.path) ? params.path : [params.path];
  
  // Format extension ID for display
  const formattedExtensionName = extensionId
    .split('-')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
  
  return (
    <div className="min-h-screen bg-gray-50 p-4 md:p-6">
      {/* Breadcrumbs */}
      <nav className="mb-4">
        <ol className="flex flex-wrap items-center text-sm text-gray-500">
          <li>
            <Link href="/msp/dashboard" className="hover:text-primary-600">
              Dashboard
            </Link>
          </li>
          <li className="mx-2">
            <ChevronRight className="h-4 w-4" />
          </li>
          <li>
            <Link href="/msp/extensions" className="hover:text-primary-600">
              Extensions
            </Link>
          </li>
          <li className="mx-2">
            <ChevronRight className="h-4 w-4" />
          </li>
          <li>
            <span className="font-medium text-gray-900">
              {formattedExtensionName}
            </span>
          </li>
          {pathSegments.map((segment, index) => (
            <React.Fragment key={index}>
              <li className="mx-2">
                <ChevronRight className="h-4 w-4" />
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
      
      {/* Main content */}
      <main className="bg-white rounded-lg shadow-sm overflow-hidden">
        {children}
      </main>
    </div>
  );
}