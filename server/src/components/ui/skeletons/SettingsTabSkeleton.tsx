import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../Card';
import LoadingIndicator from '../LoadingIndicator';

interface SettingsTabSkeletonProps {
  title?: string;
  description?: string;
  showTabs?: boolean;
  showTable?: boolean;
  showForm?: boolean;
  showDropdowns?: boolean;
  showTextArea?: boolean;
  noCard?: boolean;
}

const SettingsTabSkeleton: React.FC<SettingsTabSkeletonProps> = ({ 
  title = "Settings",
  description = "Loading settings configuration...",
  showTabs = false,
  showTable = true,
  showForm = false,
  showDropdowns = false,
  showTextArea = false,
  noCard = false
}) => {
  const content = (
    <>
      {/* Dropdown Section Skeleton */}
      {showDropdowns && (
        <div className="p-4 bg-gray-50 rounded-lg">
          <div className="flex items-end gap-3">
            <div className="space-y-2">
              <div className="h-5 bg-gray-200 rounded w-20"></div>
              <div className="h-10 bg-gray-200 rounded w-40"></div>
            </div>
            <div className="space-y-2">
              <div className="h-5 bg-gray-200 rounded w-20"></div>
              <div className="h-10 bg-gray-200 rounded w-40"></div>
            </div>
            <div className="h-10 bg-gray-200 rounded w-24"></div>
          </div>
        </div>
      )}
      
      {/* TextArea Section Skeleton - for Policy Management */}
      {showTextArea && (
        <div className="space-y-4">
          <div className="space-y-2">
            <div className="h-5 bg-gray-200 rounded w-32"></div>
            <div className="h-24 bg-gray-200 rounded w-full"></div>
            <div className="h-9 bg-gray-200 rounded w-28"></div>
          </div>
        </div>
      )}
      
      {/* Data Table Skeleton - Most common pattern */}
      {showTable && (
        <div className="space-y-4">              
          {/* Table */}
          <div className="border rounded-lg overflow-hidden">
            <div className="bg-gray-50 border-b">
              <div className="grid grid-cols-4 gap-4 p-4">
                <div className="h-4 bg-gray-200 rounded w-24"></div>
                <div className="h-4 bg-gray-200 rounded w-32"></div>
                <div className="h-4 bg-gray-200 rounded w-20"></div>
                <div className="h-4 bg-gray-200 rounded w-16"></div>
              </div>
            </div>
            
            {/* Table Rows */}
            {Array.from({ length: 5 }, (_, rowIndex) => (
              <div key={rowIndex} className="border-b last:border-b-0 bg-white">
                <div className="grid grid-cols-4 gap-4 p-4">
                  <div className="h-4 bg-gray-200 rounded"></div>
                  <div className="h-4 bg-gray-200 rounded"></div>
                  <div className="h-4 bg-gray-200 rounded"></div>
                  <div className="flex justify-center">
                    <div className="h-8 w-8 bg-gray-200 rounded"></div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      
      {/* Form Section Skeleton */}
      {showForm && !showTable && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {Array.from({ length: 4 }, (_, i) => (
              <div key={i} className="space-y-2">
                <div className="h-4 bg-gray-200 rounded w-24"></div>
                <div className="h-10 bg-gray-200 rounded w-full"></div>
              </div>
            ))}
          </div>
          
          <div className="flex justify-end space-x-2 pt-4">
            <div className="h-9 bg-gray-200 rounded w-20"></div>
            <div className="h-9 bg-gray-200 rounded w-24"></div>
          </div>
        </div>
      )}
      
      {/* Loading indicator */}
      <div className="flex items-center justify-center py-8">
        <LoadingIndicator 
          layout="stacked" 
          text={description}
          spinnerProps={{ size: 'md' }}
        />
      </div>
    </>
  );

  if (noCard) {
    return (
      <div className="animate-pulse">
        <div className="space-y-6">
          {content}
        </div>
      </div>
    );
  }

  return (
    <div className="animate-pulse">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>
                <div className="h-6 bg-gray-200 rounded w-40"></div>
              </CardTitle>
              <CardDescription>
                <span className="block h-4 bg-gray-200 rounded w-64 mt-2"></span>
              </CardDescription>
            </div>
            <div className="h-9 bg-gray-200 rounded w-24"></div>
          </div>
        </CardHeader>
        
        <CardContent className="space-y-6">
          {content}
        </CardContent>
      </Card>
    </div>
  );
};

export default SettingsTabSkeleton;