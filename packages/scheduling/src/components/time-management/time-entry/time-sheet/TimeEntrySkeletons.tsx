'use client';

import { memo } from 'react';
import { Skeleton } from '@alga-psa/ui/components/Skeleton';

const TimeEntrySkeletons = memo(function TimeEntrySkeletons() {
  return (
    <div className="space-y-4">
      {[1, 2].map((i) => (
        <div key={`skeleton-${i}`} className="border p-4 rounded">
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        </div>
      ))}
    </div>
  );
});

export default TimeEntrySkeletons;