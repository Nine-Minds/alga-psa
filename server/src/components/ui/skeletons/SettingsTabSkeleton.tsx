import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../Card';
import { Settings, Plus } from 'lucide-react';

interface SettingsTabSkeletonProps {
  title?: string;
  description?: string;
  showTabs?: boolean;
  showTable?: boolean;
  showForm?: boolean;
}

const SettingsTabSkeleton: React.FC<SettingsTabSkeletonProps> = ({ 
  title = "Settings",
  description = "Loading settings configuration...",
  showTabs = true,
  showTable = true,
  showForm = true
}) => {
  return (
    <div className="animate-pulse">
      <Card>
        <CardHeader>
          <div className="flex items-center space-x-2">
            <Settings className="h-6 w-6 text-gray-300" />
            <div>
              <CardTitle className="flex items-center">
                <div className="h-6 bg-gray-200 rounded w-32"></div>
              </CardTitle>
              <CardDescription>
                <div className="h-4 bg-gray-200 rounded w-48 mt-1"></div>
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        
        <CardContent className="space-y-6">
          {/* Tab Navigation Skeleton */}
          {showTabs && (
            <div className="border-b border-gray-200">
              <nav className="flex space-x-8">
                {Array.from({ length: 4 }, (_, i) => (
                  <div key={i} className="py-2 px-1 border-b-2 border-transparent">
                    <div className="h-4 bg-gray-200 rounded w-16"></div>
                  </div>
                ))}
              </nav>
            </div>
          )}
          
          {/* Form Section Skeleton */}
          {showForm && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="h-5 bg-gray-200 rounded w-24"></div>
                <div className="flex items-center space-x-2">
                  <Plus className="h-4 w-4 text-gray-300" />
                  <div className="h-8 bg-gray-200 rounded w-20"></div>
                </div>
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <div className="h-4 bg-gray-200 rounded w-16"></div>
                  <div className="h-9 bg-gray-200 rounded w-full"></div>
                </div>
                <div className="space-y-2">
                  <div className="h-4 bg-gray-200 rounded w-20"></div>
                  <div className="h-9 bg-gray-200 rounded w-full"></div>
                </div>
              </div>
              
              <div className="flex justify-end space-x-2">
                <div className="h-8 bg-gray-200 rounded w-16"></div>
                <div className="h-8 bg-blue-200 rounded w-20"></div>
              </div>
            </div>
          )}
          
          {/* Data Table Skeleton */}
          {showTable && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="h-6 bg-gray-200 rounded w-32"></div>
                <div className="flex items-center space-x-2">
                  <div className="h-8 bg-gray-200 rounded w-24"></div>
                  <div className="h-8 bg-gray-200 rounded w-20"></div>
                </div>
              </div>
              
              {/* Table Header */}
              <div className="border rounded-lg overflow-hidden">
                <div className="bg-gray-50 border-b">
                  <div className="grid grid-cols-4 gap-4 p-4">
                    {Array.from({ length: 4 }, (_, i) => (
                      <div key={i} className="h-4 bg-gray-200 rounded"></div>
                    ))}
                  </div>
                </div>
                
                {/* Table Rows */}
                {Array.from({ length: 5 }, (_, rowIndex) => (
                  <div key={rowIndex} className="border-b last:border-b-0">
                    <div className="grid grid-cols-4 gap-4 p-4">
                      {Array.from({ length: 4 }, (_, colIndex) => (
                        <div key={colIndex} className="h-4 bg-gray-200 rounded"></div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              
              {/* Pagination */}
              <div className="flex items-center justify-between">
                <div className="h-4 bg-gray-200 rounded w-32"></div>
                <div className="flex space-x-2">
                  <div className="h-8 bg-gray-200 rounded w-8"></div>
                  <div className="h-8 bg-gray-200 rounded w-8"></div>
                  <div className="h-8 bg-gray-200 rounded w-8"></div>
                </div>
              </div>
            </div>
          )}
          
          {/* Additional Settings Sections */}
          <div className="space-y-6">
            <div className="space-y-4">
              <div className="h-5 bg-gray-200 rounded w-28"></div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {Array.from({ length: 6 }, (_, i) => (
                  <div key={i} className="p-4 border rounded-lg space-y-2">
                    <div className="h-4 bg-gray-200 rounded w-20"></div>
                    <div className="h-3 bg-gray-200 rounded w-full"></div>
                    <div className="h-3 bg-gray-200 rounded w-3/4"></div>
                  </div>
                ))}
              </div>
            </div>
            
            <div className="space-y-4">
              <div className="h-5 bg-gray-200 rounded w-32"></div>
              <div className="space-y-3">
                {Array.from({ length: 4 }, (_, i) => (
                  <div key={i} className="flex items-center justify-between p-3 border rounded">
                    <div className="space-y-1">
                      <div className="h-4 bg-gray-200 rounded w-24"></div>
                      <div className="h-3 bg-gray-200 rounded w-40"></div>
                    </div>
                    <div className="h-6 bg-gray-200 rounded w-12"></div>
                  </div>
                ))}
              </div>
            </div>
          </div>
          
          {/* Loading indicator */}
          <div className="flex items-center justify-center py-8">
            <div className="text-center">
              <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mb-4"></div>
              <p className="text-gray-500">Loading settings...</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default SettingsTabSkeleton;