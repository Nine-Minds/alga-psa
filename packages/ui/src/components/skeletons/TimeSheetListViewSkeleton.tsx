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
            <div className="px-3 py-2 bg-gray-50 border-b border-gray-200 flex items-center justify-between">
                <div className="h-8 w-24 bg-gray-200 rounded-lg" />
                <div className="flex items-center gap-4">
                    <div className="h-4 w-16 bg-gray-200 rounded" />
                    <div className="h-4 w-20 bg-gray-200 rounded" />
                    <div className="h-4 w-24 bg-gray-200 rounded" />
                </div>
            </div>

            {/* Day sections skeleton */}
            <div className="divide-y divide-gray-200">
                {Array.from({ length: dayCount }).map((_, dayIndex) => (
                    <div key={`skeleton-day-${dayIndex}`}>
                        {/* Day header skeleton */}
                        <div className="px-3 py-2 bg-gray-50 flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <div className="h-4 w-4 bg-gray-200 rounded" />
                                <div className="h-4 w-24 bg-gray-300 rounded" />
                            </div>
                            <div className="flex items-center gap-4">
                                <div className="h-3 w-16 bg-gray-200 rounded" />
                                <div className="h-3 w-14 bg-gray-200 rounded" />
                                <div className="h-3 w-20 bg-gray-200 rounded" />
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
                                <tbody className="divide-y divide-gray-100">
                                    {Array.from({ length: dayIndex === 0 ? 2 : 1 }).map((_, rowIndex) => (
                                        <tr key={`skeleton-row-${dayIndex}-${rowIndex}`} className="bg-white">
                                            <td className="pl-3" />
                                            <td className="py-2 pr-3">
                                                <div className="flex items-center gap-2">
                                                    <div className="h-4 w-40 bg-gray-200 rounded" />
                                                    <div className="h-5 w-16 bg-gray-100 rounded" />
                                                </div>
                                            </td>
                                            <td className="py-2 px-3">
                                                <div className="h-4 w-24 bg-gray-200 rounded" />
                                            </td>
                                            <td className="py-2 px-3 text-right">
                                                <div className="h-4 w-12 bg-gray-200 rounded ml-auto" />
                                            </td>
                                            <td className="py-2 px-3">
                                                <div className="h-5 w-14 bg-gray-100 rounded" />
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
