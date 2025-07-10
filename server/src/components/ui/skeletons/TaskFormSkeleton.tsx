import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../Card';
import { CheckSquare, User, Calendar, Tag, Link } from 'lucide-react';

interface TaskFormSkeletonProps {
  title?: string;
  isEdit?: boolean;
  showTabs?: boolean;
}

const TaskFormSkeleton: React.FC<TaskFormSkeletonProps> = ({ 
  title = "Task",
  isEdit = false,
  showTabs = true
}) => {
  return (
    <div className="animate-pulse">
      <Card>
        <CardHeader>
          <div className="flex items-center space-x-2">
            <CheckSquare className="h-6 w-6 text-gray-300" />
            <div>
              <CardTitle className="flex items-center">
                <div className="h-6 bg-gray-200 rounded w-40"></div>
              </CardTitle>
              <CardDescription>
                <div className="h-4 bg-gray-200 rounded w-56 mt-1"></div>
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        
        <CardContent className="space-y-6">
          {/* Tab Navigation Skeleton */}
          {showTabs && (
            <div className="border-b border-gray-200">
              <nav className="flex space-x-8">
                {['Details', 'Assignments', 'Dependencies', 'Comments'].map((tab, i) => (
                  <div key={i} className="py-2 px-1 border-b-2 border-transparent">
                    <div className="h-4 bg-gray-200 rounded w-16"></div>
                  </div>
                ))}
              </nav>
            </div>
          )}
          
          {/* Task Details Form */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Left Column */}
            <div className="space-y-4">
              <div className="space-y-2">
                <div className="h-4 bg-gray-200 rounded w-16"></div>
                <div className="h-9 bg-gray-200 rounded w-full"></div>
              </div>
              
              <div className="space-y-2">
                <div className="h-4 bg-gray-200 rounded w-20"></div>
                <div className="h-24 bg-gray-200 rounded w-full"></div>
              </div>
              
              <div className="space-y-2">
                <div className="h-4 bg-gray-200 rounded w-12"></div>
                <div className="h-9 bg-gray-200 rounded w-full"></div>
              </div>
              
              <div className="space-y-2">
                <div className="h-4 bg-gray-200 rounded w-16"></div>
                <div className="h-9 bg-gray-200 rounded w-full"></div>
              </div>
            </div>
            
            {/* Right Column */}
            <div className="space-y-4">
              <div className="space-y-2">
                <div className="flex items-center space-x-2">
                  <User className="h-4 w-4 text-gray-300" />
                  <div className="h-4 bg-gray-200 rounded w-20"></div>
                </div>
                <div className="h-9 bg-gray-200 rounded w-full"></div>
              </div>
              
              <div className="space-y-2">
                <div className="flex items-center space-x-2">
                  <Calendar className="h-4 w-4 text-gray-300" />
                  <div className="h-4 bg-gray-200 rounded w-16"></div>
                </div>
                <div className="h-9 bg-gray-200 rounded w-full"></div>
              </div>
              
              <div className="space-y-2">
                <div className="flex items-center space-x-2">
                  <Calendar className="h-4 w-4 text-gray-300" />
                  <div className="h-4 bg-gray-200 rounded w-16"></div>
                </div>
                <div className="h-9 bg-gray-200 rounded w-full"></div>
              </div>
              
              <div className="space-y-2">
                <div className="flex items-center space-x-2">
                  <Tag className="h-4 w-4 text-gray-300" />
                  <div className="h-4 bg-gray-200 rounded w-16"></div>
                </div>
                <div className="h-9 bg-gray-200 rounded w-full"></div>
              </div>
            </div>
          </div>
          
          {/* Task Relationships Section */}
          <div className="space-y-4">
            <div className="flex items-center space-x-2">
              <Link className="h-5 w-5 text-gray-300" />
              <div className="h-5 bg-gray-200 rounded w-32"></div>
            </div>
            
            <div className="border rounded-lg p-4 space-y-3">
              {Array.from({ length: 3 }, (_, i) => (
                <div key={i} className="flex items-center justify-between p-2 border rounded">
                  <div className="flex items-center space-x-3">
                    <div className="h-4 w-4 bg-gray-200 rounded"></div>
                    <div className="space-y-1">
                      <div className="h-4 bg-gray-200 rounded w-32"></div>
                      <div className="h-3 bg-gray-200 rounded w-24"></div>
                    </div>
                  </div>
                  <div className="h-6 bg-gray-200 rounded w-16"></div>
                </div>
              ))}
            </div>
          </div>
          
          {/* Progress and Metrics */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <div className="h-4 bg-gray-200 rounded w-16"></div>
              <div className="h-2 bg-gray-200 rounded w-full"></div>
              <div className="h-3 bg-gray-200 rounded w-12"></div>
            </div>
            
            <div className="space-y-2">
              <div className="h-4 bg-gray-200 rounded w-20"></div>
              <div className="h-6 bg-gray-200 rounded w-16"></div>
            </div>
            
            <div className="space-y-2">
              <div className="h-4 bg-gray-200 rounded w-18"></div>
              <div className="h-6 bg-gray-200 rounded w-20"></div>
            </div>
          </div>
          
          {/* Action Buttons */}
          <div className="flex justify-end space-x-3 pt-4 border-t">
            <div className="h-9 bg-gray-200 rounded w-20"></div>
            <div className="h-9 bg-blue-200 rounded w-24"></div>
            {isEdit && (
              <div className="h-9 bg-red-200 rounded w-20"></div>
            )}
          </div>
          
          {/* Loading indicator */}
          <div className="flex items-center justify-center py-4">
            <div className="text-center">
              <div className="inline-block animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600 mb-2"></div>
              <p className="text-gray-500 text-sm">Loading task form...</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default TaskFormSkeleton;