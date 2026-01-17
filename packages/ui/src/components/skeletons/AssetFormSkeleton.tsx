import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../Card';
import { Package, Tag, Building, User, Calendar, FileText } from 'lucide-react';

interface AssetFormSkeletonProps {
  title?: string;
  isEdit?: boolean;
}

const AssetFormSkeleton = ({ 
  title = "Asset",
  isEdit = false
}: AssetFormSkeletonProps) => {
  return (
    <div className="animate-pulse space-y-6">
      {/* Header */}
      <Card>
        <CardHeader>
          <div className="flex items-center space-x-3">
            <Package className="h-8 w-8 text-gray-300" />
            <div>
              <CardTitle className="flex items-center">
                <div className="h-7 bg-gray-200 rounded w-40"></div>
              </CardTitle>
              <CardDescription>
                <div className="h-4 bg-gray-200 rounded w-64 mt-1"></div>
              </CardDescription>
            </div>
          </div>
        </CardHeader>
      </Card>

      {/* Main Form */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>
                <div className="h-6 bg-gray-200 rounded w-32"></div>
              </CardTitle>
              <CardDescription>
                <div className="h-4 bg-gray-200 rounded w-48 mt-1"></div>
              </CardDescription>
            </div>
            <div className="flex space-x-2">
              <div className="h-9 bg-gray-200 rounded w-20"></div>
              {isEdit && <div className="h-9 bg-red-200 rounded w-20"></div>}
              <div className="h-9 bg-blue-200 rounded w-24"></div>
            </div>
          </div>
        </CardHeader>
        
        <CardContent className="space-y-6">
          {/* Basic Information */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-4">
              <div className="space-y-2">
                <div className="flex items-center space-x-2">
                  <Tag className="h-4 w-4 text-gray-300" />
                  <div className="h-4 bg-gray-200 rounded w-20"></div>
                </div>
                <div className="h-9 bg-gray-200 rounded w-full"></div>
              </div>
              
              <div className="space-y-2">
                <div className="h-4 bg-gray-200 rounded w-24"></div>
                <div className="h-9 bg-gray-200 rounded w-full"></div>
              </div>
              
              <div className="space-y-2">
                <div className="h-4 bg-gray-200 rounded w-16"></div>
                <div className="h-9 bg-gray-200 rounded w-full"></div>
              </div>
              
              <div className="space-y-2">
                <div className="h-4 bg-gray-200 rounded w-20"></div>
                <div className="h-9 bg-gray-200 rounded w-full"></div>
              </div>
            </div>
            
            <div className="space-y-4">
              <div className="space-y-2">
                <div className="flex items-center space-x-2">
                  <Building className="h-4 w-4 text-gray-300" />
                  <div className="h-4 bg-gray-200 rounded w-16"></div>
                </div>
                <div className="h-9 bg-gray-200 rounded w-full"></div>
              </div>
              
              <div className="space-y-2">
                <div className="flex items-center space-x-2">
                  <User className="h-4 w-4 text-gray-300" />
                  <div className="h-4 bg-gray-200 rounded w-18"></div>
                </div>
                <div className="h-9 bg-gray-200 rounded w-full"></div>
              </div>
              
              <div className="space-y-2">
                <div className="flex items-center space-x-2">
                  <Calendar className="h-4 w-4 text-gray-300" />
                  <div className="h-4 bg-gray-200 rounded w-24"></div>
                </div>
                <div className="h-9 bg-gray-200 rounded w-full"></div>
              </div>
              
              <div className="space-y-2">
                <div className="h-4 bg-gray-200 rounded w-16"></div>
                <div className="h-9 bg-gray-200 rounded w-full"></div>
              </div>
            </div>
          </div>
          
          {/* Description Section */}
          <div className="space-y-4">
            <div className="flex items-center space-x-2">
              <FileText className="h-5 w-5 text-gray-300" />
              <div className="h-5 bg-gray-200 rounded w-28"></div>
            </div>
            <div className="h-24 bg-gray-200 rounded w-full"></div>
          </div>
          
          {/* Asset Categories and Tags */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-4">
              <div className="h-5 bg-gray-200 rounded w-20"></div>
              <div className="space-y-2">
                {Array.from({ length: 3 }, (_, i) => (
                  <div key={i} className="flex items-center space-x-2 p-2 border rounded">
                    <div className="h-4 w-4 bg-gray-200 rounded"></div>
                    <div className="h-4 bg-gray-200 rounded flex-1"></div>
                    <div className="h-6 bg-gray-200 rounded w-6"></div>
                  </div>
                ))}
              </div>
            </div>
            
            <div className="space-y-4">
              <div className="h-5 bg-gray-200 rounded w-24"></div>
              <div className="flex flex-wrap gap-2">
                {Array.from({ length: 4 }, (_, i) => (
                  <div key={i} className="h-6 bg-blue-100 rounded-full px-3 py-1">
                    <div className="h-3 bg-blue-200 rounded w-12"></div>
                  </div>
                ))}
              </div>
            </div>
          </div>
          
          {/* Asset Status and Warranty */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <div className="h-4 bg-gray-200 rounded w-16"></div>
              <div className="h-6 bg-green-100 rounded w-20 px-2 py-1">
                <div className="h-3 bg-green-200 rounded w-12"></div>
              </div>
            </div>
            
            <div className="space-y-2">
              <div className="h-4 bg-gray-200 rounded w-20"></div>
              <div className="h-6 bg-gray-200 rounded w-24"></div>
            </div>
            
            <div className="space-y-2">
              <div className="h-4 bg-gray-200 rounded w-18"></div>
              <div className="h-6 bg-gray-200 rounded w-28"></div>
            </div>
          </div>
          
          {/* Loading indicator */}
          <div className="flex items-center justify-center py-8">
            <div className="text-center">
              <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mb-4"></div>
              <p className="text-gray-500">Loading asset form...</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default AssetFormSkeleton;
