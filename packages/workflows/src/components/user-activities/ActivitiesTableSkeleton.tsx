import React from 'react';

import { Skeleton } from '@alga-psa/ui/components/Skeleton';

interface ActivitiesTableSkeletonProps {
  rowCount?: number;
}

export function ActivitiesTableSkeleton({ rowCount = 5 }: ActivitiesTableSkeletonProps) {
  return (
    <div className="w-full">
      {/* Table header skeleton */}
      <div className="border-b border-gray-200 bg-gray-50">
        <div className="flex items-center py-3 px-4">
          <div className="w-[10%]"><Skeleton className="h-4 w-12" /></div>
          <div className="w-[50%]"><Skeleton className="h-4 w-16" /></div>
          <div className="w-[15%]"><Skeleton className="h-4 w-14" /></div>
          <div className="w-[10%]"><Skeleton className="h-4 w-16" /></div>
          <div className="w-[10%]"><Skeleton className="h-4 w-20" /></div>
          <div className="w-[5%]"><Skeleton className="h-4 w-16" /></div>
        </div>
      </div>

      {/* Table rows skeleton */}
      <div className="divide-y divide-gray-100">
        {Array.from({ length: rowCount }).map((_, index) => (
          <div key={`skeleton-row-${index}`} className="flex items-center py-4 px-4">
            {/* Type column */}
            <div className="w-[10%] flex items-center gap-2">
              <Skeleton className="h-4 w-4 rounded" />
              <Skeleton className="h-3 w-16" />
            </div>

            {/* Title column */}
            <div className="w-[50%]">
              <Skeleton className="h-4 w-3/4" />
            </div>

            {/* Status column */}
            <div className="w-[15%]">
              <Skeleton className="h-6 w-20 rounded-full" />
            </div>

            {/* Priority column */}
            <div className="w-[10%] flex items-center gap-2">
              <Skeleton className="h-2 w-2 rounded-full" />
              <Skeleton className="h-3 w-12" />
            </div>

            {/* Due Date column */}
            <div className="w-[10%] flex flex-col gap-1">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-2 w-16" />
            </div>

            {/* Actions column */}
            <div className="w-[5%]">
              <Skeleton className="h-8 w-8 rounded" />
            </div>
          </div>
        ))}
      </div>

      {/* Pagination skeleton */}
      <div className="flex items-center justify-between py-4 px-4 border-t border-gray-200">
        <Skeleton className="h-4 w-32" />
        <div className="flex items-center gap-2">
          <Skeleton className="h-8 w-8 rounded" />
          <Skeleton className="h-8 w-8 rounded" />
          <Skeleton className="h-4 w-16" />
          <Skeleton className="h-8 w-8 rounded" />
          <Skeleton className="h-8 w-8 rounded" />
        </div>
      </div>
    </div>
  );
}
