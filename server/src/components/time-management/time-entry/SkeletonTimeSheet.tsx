import { Skeleton } from 'server/src/components/ui/Skeleton';

export function SkeletonTimeSheet() {
  return (
    <div className="space-y-4">
      {/* Header skeleton */}
      <div className="flex justify-between items-center mb-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-8 w-24" />
      </div>

      {/* Time periods skeleton */}
      {Array.from({ length: 3 }).map((_, i): React.JSX.Element => (
        <div key={i} className="flex items-center space-x-4 p-4 border rounded-lg">
          <Skeleton className="h-16 w-full" />
        </div>
      ))}
    </div>
  );
}
