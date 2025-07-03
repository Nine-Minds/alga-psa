import React from 'react';

export default function ContactsSkeleton() {
  return (
    <div className="p-6">
      <div className="animate-pulse">
        {/* Header skeleton */}
        <div className="flex justify-between items-center mb-4">
          <div className="h-8 bg-gray-200 rounded w-1/4"></div>
          <div className="h-10 bg-gray-200 rounded w-32"></div>
        </div>
        
        <div className="bg-white shadow rounded-lg p-4">
          {/* Filters skeleton */}
          <div className="flex justify-between items-center mb-4">
            <div className="flex items-center gap-4">
              <div className="h-10 bg-gray-200 rounded w-64"></div>
              <div className="h-10 bg-gray-200 rounded w-40"></div>
              <div className="h-10 bg-gray-200 rounded w-40"></div>
            </div>
            <div className="h-10 bg-gray-200 rounded w-32"></div>
          </div>
          
          {/* Table header skeleton */}
          <div className="h-12 bg-gray-100 rounded w-full mb-2"></div>
          
          {/* Table rows skeleton */}
          {Array(10).fill(0).map((_, i) => (
            <div key={i} className="h-16 bg-gray-200 rounded w-full mb-2"></div>
          ))}
          
          {/* Pagination skeleton */}
          <div className="flex justify-between items-center mt-4">
            <div className="h-8 bg-gray-200 rounded w-32"></div>
            <div className="flex gap-2">
              <div className="h-8 bg-gray-200 rounded w-8"></div>
              <div className="h-8 bg-gray-200 rounded w-8"></div>
              <div className="h-8 bg-gray-200 rounded w-8"></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}