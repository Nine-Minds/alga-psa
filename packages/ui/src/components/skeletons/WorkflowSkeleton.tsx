import React from 'react';

interface WorkflowSkeletonProps {
  height?: number | string;
  width?: number | string;
  showControls?: boolean;
  showLegend?: boolean;
}

const WorkflowSkeleton = ({ 
  height = 600, 
  width = '100%', 
  showControls = true, 
  showLegend = true 
}: WorkflowSkeletonProps) => {
  return (
    <div className="workflow-visualizer relative animate-pulse" style={{ height, width }}>
      {/* Main visualization area */}
      <div className="absolute inset-0 bg-gray-50 border rounded-lg">
        {/* Simulated workflow nodes */}
        <div className="absolute top-8 left-8 w-20 h-12 bg-blue-200 rounded-lg"></div>
        <div className="absolute top-8 left-36 w-20 h-12 bg-green-200 rounded-lg"></div>
        <div className="absolute top-8 left-64 w-20 h-12 bg-yellow-200 rounded-lg"></div>
        <div className="absolute top-24 left-36 w-20 h-12 bg-purple-200 rounded-lg"></div>
        <div className="absolute top-24 left-64 w-20 h-12 bg-red-200 rounded-lg"></div>
        
        {/* Simulated connection lines */}
        <div className="absolute top-14 left-28 w-8 h-0.5 bg-gray-300"></div>
        <div className="absolute top-14 left-56 w-8 h-0.5 bg-gray-300"></div>
        <div className="absolute top-20 left-42 w-0.5 h-4 bg-gray-300"></div>
        <div className="absolute top-30 left-56 w-8 h-0.5 bg-gray-300"></div>
        
        {/* Background grid pattern */}
        <div className="absolute inset-0 opacity-20" style={{
          backgroundImage: 'radial-gradient(circle, #ccc 1px, transparent 1px)',
          backgroundSize: '20px 20px'
        }}></div>
        
        {/* Loading indicator */}
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="text-center">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mb-4"></div>
            <p className="text-gray-500">Loading workflow visualization...</p>
          </div>
        </div>
      </div>
      
      {/* Controls skeleton */}
      {showControls && (
        <div className="absolute top-4 right-4 flex flex-col gap-2">
          <div className="w-10 h-10 bg-gray-200 rounded-md shadow-sm"></div>
          <div className="w-10 h-10 bg-gray-200 rounded-md shadow-sm"></div>
          <div className="w-10 h-10 bg-gray-200 rounded-md shadow-sm"></div>
        </div>
      )}
      
      {/* Legend skeleton */}
      {showLegend && (
        <div className="absolute bottom-4 right-4 bg-white p-3 rounded-md shadow-md border border-gray-200 w-40">
          <div className="h-4 bg-gray-200 rounded mb-2"></div>
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 bg-blue-200 rounded"></div>
              <div className="h-3 bg-gray-200 rounded flex-1"></div>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 bg-green-200 rounded"></div>
              <div className="h-3 bg-gray-200 rounded flex-1"></div>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 bg-yellow-200 rounded"></div>
              <div className="h-3 bg-gray-200 rounded flex-1"></div>
            </div>
          </div>
        </div>
      )}
      
      {/* Minimap skeleton */}
      <div className="absolute bottom-4 left-4 w-24 h-16 bg-gray-200 rounded border shadow-sm"></div>
      
      {/* Bottom controls skeleton */}
      <div className="absolute bottom-4 left-32 flex gap-2">
        <div className="w-8 h-8 bg-gray-200 rounded"></div>
        <div className="w-8 h-8 bg-gray-200 rounded"></div>
        <div className="w-8 h-8 bg-gray-200 rounded"></div>
        <div className="w-8 h-8 bg-gray-200 rounded"></div>
      </div>
    </div>
  );
};

export default WorkflowSkeleton;
