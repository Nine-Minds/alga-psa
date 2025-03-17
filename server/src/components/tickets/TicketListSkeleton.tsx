import React from 'react';

export default function TicketListSkeleton() {
  return (
    <div id="ticket-list-skeleton" className="bg-white shadow rounded-lg p-4">
      <div className="animate-pulse">
        {/* Header skeleton */}
        <div className="flex justify-between items-center mb-4">
          <div className="h-8 bg-gray-200 rounded w-1/4"></div>
          <div className="h-10 bg-gray-200 rounded w-32"></div>
        </div>
        
        {/* Filters skeleton */}
        <div className="flex items-center gap-3 flex-nowrap mb-6 overflow-x-auto">
          <div className="h-10 bg-gray-200 rounded w-40 flex-shrink-0"></div>
          <div className="h-10 bg-gray-200 rounded w-40 flex-shrink-0"></div>
          <div className="h-10 bg-gray-200 rounded w-40 flex-shrink-0"></div>
          <div className="h-10 bg-gray-200 rounded w-40 flex-shrink-0"></div>
          <div className="h-10 bg-gray-200 rounded w-40 flex-shrink-0"></div>
          <div className="h-10 bg-gray-200 rounded w-40 flex-shrink-0"></div>
        </div>
        
        {/* Table header skeleton */}
        <div className="h-12 bg-gray-200 rounded w-full mb-2"></div>
        
        {/* Table rows skeleton */}
        {Array(5).fill(0).map((_, i) => (
          <div key={i} className="h-16 bg-gray-200 rounded w-full mb-2"></div>
        ))}
      </div>
    </div>
  );
}