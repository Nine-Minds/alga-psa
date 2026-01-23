import React from 'react';
import { Type, Bold, Italic, List, ListOrdered, Quote, Link, Image } from 'lucide-react';

interface RichTextEditorSkeletonProps {
  height?: string;
  showToolbar?: boolean;
  title?: string;
}

const RichTextEditorSkeleton = ({ 
  height = "300px", 
  showToolbar = true,
  title = "Rich Text Editor"
}: RichTextEditorSkeletonProps) => {
  return (
    <div className="animate-pulse border rounded-lg overflow-hidden bg-white">
      {/* Toolbar Skeleton */}
      {showToolbar && (
        <div className="border-b bg-gray-50 p-2">
          <div className="flex items-center space-x-1">
            {/* Formatting buttons */}
            <div className="flex items-center space-x-1 mr-3">
              <Bold className="h-4 w-4 text-gray-300 p-1 border rounded" />
              <Italic className="h-4 w-4 text-gray-300 p-1 border rounded" />
              <div className="h-6 w-px bg-gray-300 mx-1"></div>
              <List className="h-4 w-4 text-gray-300 p-1 border rounded" />
              <ListOrdered className="h-4 w-4 text-gray-300 p-1 border rounded" />
              <Quote className="h-4 w-4 text-gray-300 p-1 border rounded" />
            </div>
            
            {/* Separator */}
            <div className="h-6 w-px bg-gray-300 mx-2"></div>
            
            {/* Additional tools */}
            <div className="flex items-center space-x-1">
              <Link className="h-4 w-4 text-gray-300 p-1 border rounded" />
              <Image className="h-4 w-4 text-gray-300 p-1 border rounded" />
            </div>
            
            {/* Text style dropdown */}
            <div className="ml-auto">
              <div className="h-6 bg-gray-200 rounded w-20"></div>
            </div>
          </div>
        </div>
      )}
      
      {/* Editor Content Area */}
      <div className="relative overflow-hidden" style={{ height }}>
        <div className="p-4 space-y-4">
          {/* Simulated text blocks */}
          <div className="space-y-2">
            <div className="h-4 bg-gray-200 rounded w-3/4"></div>
            <div className="h-4 bg-gray-200 rounded w-full"></div>
            <div className="h-4 bg-gray-200 rounded w-5/6"></div>
          </div>
          
          <div className="space-y-2">
            <div className="h-4 bg-gray-200 rounded w-2/3"></div>
            <div className="h-4 bg-gray-200 rounded w-4/5"></div>
          </div>
          
          {/* Simulated list */}
          <div className="space-y-2 ml-4">
            <div className="flex items-center space-x-2">
              <div className="h-2 w-2 bg-gray-300 rounded-full"></div>
              <div className="h-4 bg-gray-200 rounded w-1/2"></div>
            </div>
            <div className="flex items-center space-x-2">
              <div className="h-2 w-2 bg-gray-300 rounded-full"></div>
              <div className="h-4 bg-gray-200 rounded w-2/3"></div>
            </div>
            <div className="flex items-center space-x-2">
              <div className="h-2 w-2 bg-gray-300 rounded-full"></div>
              <div className="h-4 bg-gray-200 rounded w-1/3"></div>
            </div>
          </div>
          
          <div className="space-y-2">
            <div className="h-4 bg-gray-200 rounded w-full"></div>
            <div className="h-4 bg-gray-200 rounded w-3/4"></div>
          </div>
          
          {/* Simulated quote block */}
          <div className="border-l-4 border-gray-300 pl-4 space-y-2">
            <div className="h-4 bg-gray-200 rounded w-4/5"></div>
            <div className="h-4 bg-gray-200 rounded w-2/3"></div>
          </div>
        </div>
        
        {/* Cursor indicator */}
        <div className="absolute top-4 left-4">
          <div className="w-px h-4 bg-blue-400 animate-pulse"></div>
        </div>
        
        {/* Loading overlay */}
        <div className="absolute inset-0 bg-white/50 flex items-center justify-center">
          <div className="text-center">
            <div className="inline-block animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600 mb-2"></div>
            <p className="text-gray-500 text-sm">Loading {title.toLowerCase()}...</p>
          </div>
        </div>
      </div>
      
      {/* Footer/Status Bar */}
      <div className="border-t bg-gray-50 px-4 py-2 flex items-center justify-between text-xs text-gray-500">
        <div className="flex items-center space-x-4">
          <div className="h-3 bg-gray-200 rounded w-16"></div>
          <div className="h-3 bg-gray-200 rounded w-12"></div>
        </div>
        <div className="flex items-center space-x-2">
          <Type className="h-3 w-3 text-gray-300" />
          <div className="h-3 bg-gray-200 rounded w-8"></div>
        </div>
      </div>
    </div>
  );
};

export default RichTextEditorSkeleton;
