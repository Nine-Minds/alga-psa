import React from 'react';
import { Card } from '../Card';
import { Code2 } from 'lucide-react';

interface EditorSkeletonProps {
  height?: string;
  showHeader?: boolean;
  showButtons?: boolean;
}

const EditorSkeleton = ({ 
  height = "70vh", 
  showHeader = true, 
  showButtons = true 
}: EditorSkeletonProps) => {
  return (
    <Card className="p-4 animate-pulse">
      {showHeader && (
        <div className="flex justify-between items-center mb-4">
          <div className="flex items-center">
            <Code2 className="h-5 w-5 text-gray-300 mr-2" />
            <div className="h-6 bg-gray-200 rounded w-48"></div>
          </div>
          {showButtons && (
            <div className="flex space-x-2">
              <div className="h-9 bg-gray-200 rounded w-20"></div>
              <div className="h-9 bg-gray-200 rounded w-16"></div>
            </div>
          )}
        </div>
      )}
      
      <div className="border rounded-md overflow-hidden bg-gray-50" style={{ height }}>
        <div className="flex items-center justify-center h-full">
          <div className="text-center">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mb-4"></div>
            <p className="text-gray-500">Loading editor...</p>
          </div>
        </div>
      </div>
    </Card>
  );
};

export default EditorSkeleton;
