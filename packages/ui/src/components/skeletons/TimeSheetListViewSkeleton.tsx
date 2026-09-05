import React from 'react';

interface TimeSheetListViewSkeletonProps {
    dayCount?: number;
}

const TimeSheetListViewSkeleton = ({
    dayCount = 3
}: TimeSheetListViewSkeletonProps) => {
    return (
        <div className="animate-pulse">
            {/* Header skeleton */}
            <div className="px-3 py-2 bg-[rgb(var(--color-border-50))] border-b border-[rgb(var(--color-border-200))] flex items-center justify-between">
                <div className="h-8 w-24 skeleton-fill rounded-lg" />
                <div className="flex items-center gap-4">
                    <div className="h-4 w-16 skeleton-fill rounded" />
                    <div className="h-4 w-20 skeleton-fill rounded" />
                    <div className="h-4 w-24 skeleton-fill rounded" />
                </div>
            </div>

            {/* Day sections skeleton */}
            <div className="divide-y divide-[rgb(var(--color-border-200))]">
                {Array.from({ length: dayCount }).map((_, dayIndex) => (
                    <div key={`skeleton-day-${dayIndex}`}>
                        {/* Day header skeleton */}
                        <div className="px-3 py-2 bg-[rgb(var(--color-border-50))] flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <div className="h-4 w-4 skeleton-fill rounded" />
                                <div className="h-4 w-24 skeleton-fill-strong rounded" />
                            </div>
                            <div className="flex items-center gap-4">
                                <div className="h-3 w-16 skeleton-fill rounded" />
                                <div className="h-3 w-14 skeleton-fill rounded" />
                                <div className="h-3 w-20 skeleton-fill rounded" />
                            </div>
                        </div>

                        {/* Entry rows skeleton - only for first 2 days */}
                        {dayIndex < 2 && (
                            <table className="w-full table-fixed">
                                <colgroup>
                                    <col style={{ width: '3%' }} />
                                    <col style={{ width: '40%' }} />
                                    <col style={{ width: '20%' }} />
                                    <col style={{ width: '12%' }} />
                                    <col style={{ width: '15%' }} />
                                    <col style={{ width: '10%' }} />
                                </colgroup>
                                <tbody className="divide-y divide-[rgb(var(--color-border-100))]">
                                    {Array.from({ length: dayIndex === 0 ? 2 : 1 }).map((_, rowIndex) => (
                                        <tr key={`skeleton-row-${dayIndex}-${rowIndex}`} className="bg-[rgb(var(--color-card))]">
                                            <td className="pl-3" />
                                            <td className="py-2 pr-3">
                                                <div className="flex items-center gap-2">
                                                    <div className="h-4 w-40 skeleton-fill rounded" />
                                                    <div className="h-5 w-16 skeleton-fill rounded" />
                                                </div>
                                            </td>
                                            <td className="py-2 px-3">
                                                <div className="h-4 w-24 skeleton-fill rounded" />
                                            </td>
                                            <td className="py-2 px-3 text-right">
                                                <div className="h-4 w-12 skeleton-fill rounded ml-auto" />
                                            </td>
                                            <td className="py-2 px-3">
                                                <div className="h-5 w-14 skeleton-fill rounded" />
                                            </td>
                                            <td className="py-2 px-3" />
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        )}
                    </div>
                ))}
            </div>
        </div>
    );
};

export default TimeSheetListViewSkeleton;
