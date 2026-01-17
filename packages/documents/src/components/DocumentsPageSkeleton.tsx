'use client';

import { ReflectionContainer } from '@alga-psa/ui/ui-reflection/ReflectionContainer';

/**
 * DocumentSkeletonCard - A skeleton loading component for document cards
 */
export function DocumentSkeletonCard({ id }: { id: string }): React.JSX.Element {
  return (
    <ReflectionContainer id={id} label="Document Skeleton Card">
      <div className="bg-white rounded-lg border border-[rgb(var(--color-border-200))] shadow-sm p-4 h-full flex flex-col">
        <div className="flex-1">
          {/* Document header with icon and title */}
          <div className="flex items-start justify-between mb-3">
            <div className="flex-1 min-w-0 mr-2">
              <div className="flex items-center space-x-2">
                {/* Icon skeleton */}
                <div className="w-6 h-6 bg-gray-200 rounded-md animate-pulse"></div>
                {/* Title skeleton */}
                <div className="h-5 bg-gray-200 rounded-md w-3/4 animate-pulse"></div>
              </div>
              {/* Author and date skeleton */}
              <div className="mt-1 h-3 bg-gray-200 rounded-md w-2/3 animate-pulse"></div>
              {/* Type skeleton */}
              <div className="mt-1 h-3 bg-gray-200 rounded-md w-1/2 animate-pulse"></div>
            </div>
          </div>

          {/* Document metadata */}
          <div className="space-y-1">
            {/* Mime type skeleton */}
            <div className="h-3 bg-gray-200 rounded-md w-1/3 animate-pulse"></div>
            {/* File size skeleton */}
            <div className="h-3 bg-gray-200 rounded-md w-1/4 animate-pulse"></div>
          </div>

          {/* Preview content skeleton */}
          <div className="mt-4 preview-container">
            <div
              className="bg-gray-200 rounded-md animate-pulse"
              style={{ height: '150px', width: '100%' }}
            ></div>
          </div>
        </div>

        {/* Action buttons skeleton */}
        <div className="mt-4 pt-3 flex flex-col space-y-1.5 items-end border-t border-[rgb(var(--color-border-100))]">
          {/* Download button skeleton */}
          <div className="h-8 bg-gray-200 rounded-md w-24 animate-pulse"></div>
          {/* Delete button skeleton */}
          <div className="h-8 bg-gray-200 rounded-md w-20 animate-pulse"></div>
        </div>
      </div>
    </ReflectionContainer>
  );
}

/**
 * DocumentsGridSkeleton - A skeleton loading component for the documents grid
 */
export function DocumentsGridSkeleton({
  count = 6,
  gridColumns = 3
}: {
  count?: number,
  gridColumns?: 3 | 4
}): React.JSX.Element {
  const gridColumnsClass = gridColumns === 4
    ? 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4'
    : 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3';

  return (
    <div className={`grid ${gridColumnsClass} gap-4`}>
      {Array.from({ length: count }).map((_, index) => (
        <div key={`skeleton-${index}`} className="h-full">
          <DocumentSkeletonCard id={`document-skeleton-${index}`} />
        </div>
      ))}
    </div>
  );
}

/**
 * DocumentsPageSkeleton - A skeleton loading component for the entire Documents page
 */
export default function DocumentsPageSkeleton(): React.JSX.Element {
  return (
    <div className="p-6">
      {/* Skeleton for page header */}
      <div className="mb-6">
        <div className="h-8 w-48 bg-gray-200 rounded-md animate-pulse"></div>
      </div>
      
      <div className="flex gap-6">
        {/* Skeleton for filters sidebar */}
        <div className="w-80">
          <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-4">
            <div className="space-y-4">
              {/* Search input skeleton */}
              <div>
                <div className="h-5 w-32 bg-gray-200 rounded-md animate-pulse mb-2"></div>
                <div className="h-10 w-full bg-gray-200 rounded-md animate-pulse"></div>
              </div>
              
              {/* Document type filter skeleton */}
              <div>
                <div className="h-5 w-32 bg-gray-200 rounded-md animate-pulse mb-2"></div>
                <div className="h-10 w-full bg-gray-200 rounded-md animate-pulse"></div>
              </div>
              
              {/* Entity type filter skeleton */}
              <div>
                <div className="h-5 w-40 bg-gray-200 rounded-md animate-pulse mb-2"></div>
                <div className="h-10 w-full bg-gray-200 rounded-md animate-pulse"></div>
              </div>
              
              {/* User filter skeleton */}
              <div>
                <div className="h-5 w-28 bg-gray-200 rounded-md animate-pulse mb-2"></div>
                <div className="h-10 w-full bg-gray-200 rounded-md animate-pulse"></div>
              </div>
              
              {/* Date filter skeletons */}
              <div>
                <div className="h-5 w-36 bg-gray-200 rounded-md animate-pulse mb-2"></div>
                <div className="h-10 w-full bg-gray-200 rounded-md animate-pulse"></div>
              </div>
              
              <div>
                <div className="h-5 w-36 bg-gray-200 rounded-md animate-pulse mb-2"></div>
                <div className="h-10 w-full bg-gray-200 rounded-md animate-pulse"></div>
              </div>
              
              {/* Sort filter skeleton */}
              <div>
                <div className="h-5 w-20 bg-gray-200 rounded-md animate-pulse mb-2"></div>
                <div className="flex items-center space-x-2">
                  <div className="h-10 flex-1 bg-gray-200 rounded-md animate-pulse"></div>
                  <div className="h-10 w-10 bg-gray-200 rounded-md animate-pulse"></div>
                </div>
              </div>
              
              {/* Clear filters button skeleton */}
              <div className="pt-4">
                <div className="h-10 w-full bg-gray-200 rounded-md animate-pulse"></div>
              </div>
            </div>
          </div>
        </div>
        
        {/* Skeleton for documents content */}
        <div className="flex-1">
          <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-4">
            <DocumentsGridSkeleton />
          </div>
        </div>
      </div>
    </div>
  );
}