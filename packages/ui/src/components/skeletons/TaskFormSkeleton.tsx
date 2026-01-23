import React from 'react';
import { User, Calendar, Tag, Link, ListChecks, Paperclip } from 'lucide-react';

interface TaskFormSkeletonProps {
  isEdit?: boolean;
}

const TaskFormSkeleton = ({ 
  isEdit = false
}: TaskFormSkeletonProps) => {
  return (
    <div className="animate-pulse max-h-[90vh] overflow-y-auto">
      <div className="space-y-4">
        {/* Full width Title */}
        <div>
          <div className="h-4 bg-gray-200 rounded w-24 mb-1"></div>
          <div className="h-12 bg-gray-200 rounded w-full"></div>
        </div>

        {/* Full width Description */}
        <div>
          <div className="h-4 bg-gray-200 rounded w-20 mb-1"></div>
          <div className="h-24 bg-gray-200 rounded w-full"></div>
        </div>
          
        {/* 2 Column Grid Section */}
        <div className="grid grid-cols-2 gap-4">
          {/* Row 1: Task Type and Priority */}
          <div>
            <div className="h-4 bg-gray-200 rounded w-20 mb-1"></div>
            <div className="h-9 bg-gray-200 rounded w-full"></div>
          </div>
          <div>
            <div className="h-4 bg-gray-200 rounded w-16 mb-1"></div>
            <div className="h-9 bg-gray-200 rounded w-full"></div>
          </div>

          {/* Row 2: Move To and Duplicate To (Edit mode only) */}
          {isEdit && (
            <>
              <div>
                <div className="h-4 bg-gray-200 rounded w-16 mb-1"></div>
                <div className="h-9 bg-gray-200 rounded w-full"></div>
              </div>
              <div>
                <div className="h-4 bg-gray-200 rounded w-24 mb-1"></div>
                <div className="h-9 bg-gray-200 rounded w-full"></div>
              </div>
            </>
          )}

          {/* Row 3: Created At and Due Date */}
          <div>
            <div className="h-4 bg-gray-200 rounded w-20 mb-1"></div>
            <div className="h-9 bg-gray-100 rounded w-full"></div>
          </div>
          <div>
            <div className="h-4 bg-gray-200 rounded w-16 mb-1"></div>
            <div className="h-9 bg-gray-200 rounded w-full"></div>
          </div>

          {/* Row 4: Estimated Hours and Actual Hours */}
          <div>
            <div className="h-4 bg-gray-200 rounded w-28 mb-1"></div>
            <div className="h-9 bg-gray-200 rounded w-full"></div>
          </div>
          <div>
            <div className="h-4 bg-gray-200 rounded w-24 mb-1"></div>
            <div className="h-9 bg-gray-200 rounded w-full"></div>
          </div>

          {/* Row 5: Assigned To and Additional Agents */}
          <div>
            <div className="h-4 bg-gray-200 rounded w-20 mb-1"></div>
            <div className="h-9 bg-gray-200 rounded w-full"></div>
          </div>
          <div>
            <div className="h-4 bg-gray-200 rounded w-32 mb-1"></div>
            <div className="h-20 bg-gray-100 rounded w-full"></div>
          </div>
        </div>
          
        {/* Full width Tags section (Edit mode only) */}
        {isEdit && (
          <div>
            <div className="flex items-center gap-2 mb-2">
              <Tag className="h-4 w-4 text-gray-300" />
              <div className="h-5 bg-gray-200 rounded w-12"></div>
            </div>
            <div className="flex gap-2">
              <div className="h-6 bg-gray-200 rounded-full px-3 py-1 w-20"></div>
              <div className="h-6 bg-gray-200 rounded-full px-3 py-1 w-24"></div>
              <div className="h-6 w-6 bg-gray-200 rounded"></div>
            </div>
          </div>
        )}

        {/* Full width Checklist section */}
        <div>
          <div className="flex items-center gap-2 mb-2">
            <div className="h-5 bg-gray-200 rounded w-20"></div>
            <ListChecks className="h-5 w-5 text-gray-300" />
          </div>
          <div className="space-y-2">
            {Array.from({ length: 2 }, (_, i) => (
              <div key={i} className="flex items-center gap-2">
                <div className="h-4 w-4 bg-gray-200 rounded"></div>
                <div className="h-4 bg-gray-200 rounded w-48"></div>
              </div>
            ))}
          </div>
        </div>

        {/* Full width Dependencies section (Edit mode only) */}
        {isEdit && (
          <div>
            <div className="flex items-center gap-2 mb-2">
              <Link className="h-4 w-4 text-gray-300" />
              <div className="h-5 bg-gray-200 rounded w-24"></div>
            </div>
            <div className="h-9 bg-gray-200 rounded w-32"></div>
          </div>
        )}

        {/* Full width Associated Tickets section */}
        <div>
          <div className="flex items-center gap-2 mb-2">
            <div className="h-5 bg-gray-200 rounded w-32"></div>
          </div>
          <div className="h-20 bg-gray-100 rounded w-full"></div>
        </div>

        {/* Full width Attachments section (Edit mode only) */}
        {isEdit && (
          <div>
            <div className="flex items-center gap-2 mb-2">
              <Paperclip className="h-5 w-5 text-gray-300" />
              <div className="h-5 bg-gray-200 rounded w-24"></div>
            </div>
            <div className="h-16 bg-gray-100 rounded w-full"></div>
          </div>
        )}
        
        {/* Action Buttons */}
        <div className="flex justify-between mt-6 pt-4 border-t">
          <div className="flex gap-2">
            <div className="h-9 bg-gray-200 rounded w-20"></div>
            {isEdit && (
              <div className="h-9 bg-gray-200 rounded w-20"></div>
            )}
          </div>
          <div className="flex gap-2">
            {isEdit && (
              <div className="h-9 bg-gray-200 rounded w-36"></div>
            )}
            <div className="h-9 bg-gray-200 rounded w-20"></div>
          </div>
        </div>
          
        {/* Loading indicator */}
        <div className="flex items-center justify-center py-4">
          <div className="text-center">
            <div className="inline-block animate-spin rounded-full h-6 w-6 border-b-2 border-purple-600 mb-2"></div>
            <p className="text-gray-500 text-sm">Loading task form...</p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default TaskFormSkeleton;
