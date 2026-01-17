import React from 'react';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';

interface CalendarSkeletonProps {
  height?: string;
  view?: 'month' | 'week' | 'day';
  showSidebar?: boolean;
}

const CalendarSkeleton = ({ 
  height = "100%", 
  view = "week", 
  showSidebar = true 
}: CalendarSkeletonProps) => {
  const generateTimeSlots = () => {
    const slots: React.JSX.Element[] = [];
    for (let hour = 8; hour < 18; hour++) {
      slots.push(
        <div key={hour} className="h-16 border-b border-gray-200 flex items-center px-2">
          <div className="w-12 h-4 bg-gray-200 rounded mr-4"></div>
          <div className="flex-1 space-y-2">
            {Math.random() > 0.5 && (
              <div className="h-8 bg-blue-100 rounded border-l-4 border-blue-300 px-2 flex items-center">
                <div className="w-24 h-3 bg-blue-200 rounded"></div>
              </div>
            )}
            {Math.random() > 0.7 && (
              <div className="h-6 bg-green-100 rounded border-l-4 border-green-300 px-2 flex items-center">
                <div className="w-16 h-3 bg-green-200 rounded"></div>
              </div>
            )}
          </div>
        </div>
      );
    }
    return slots;
  };

  const generateWeekView = () => {
    const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    return (
      <div className="flex flex-1">
        {/* Time column */}
        <div className="w-16 border-r border-gray-200">
          <div className="h-12 border-b border-gray-200"></div>
          {Array.from({ length: 10 }, (_, i) => (
            <div key={i} className="h-16 border-b border-gray-200 flex items-start pt-1 px-2">
              <div className="w-8 h-3 bg-gray-200 rounded text-xs"></div>
            </div>
          ))}
        </div>
        
        {/* Days columns */}
        {days.map((day, index) => (
          <div key={day} className="flex-1 border-r border-gray-200">
            <div className="h-12 border-b border-gray-200 flex items-center justify-center">
              <div className="w-8 h-4 bg-gray-200 rounded mr-2"></div>
              <div className="w-6 h-6 bg-gray-200 rounded"></div>
            </div>
            {Array.from({ length: 10 }, (_, i) => (
              <div key={i} className="h-16 border-b border-gray-200 relative">
                {/* Random event blocks */}
                {Math.random() > 0.6 && (
                  <div className="absolute top-2 left-1 right-1 h-12 bg-blue-100 border-l-4 border-blue-300 rounded p-1">
                    <div className="w-full h-2 bg-blue-200 rounded mb-1"></div>
                    <div className="w-2/3 h-2 bg-blue-200 rounded"></div>
                  </div>
                )}
                {Math.random() > 0.8 && (
                  <div className="absolute top-8 left-1 right-1 h-6 bg-green-100 border-l-4 border-green-300 rounded p-1">
                    <div className="w-1/2 h-2 bg-green-200 rounded"></div>
                  </div>
                )}
              </div>
            ))}
          </div>
        ))}
      </div>
    );
  };

  const generateMonthView = () => {
    const weeks = Array.from({ length: 5 }, (_, weekIndex) => (
      <div key={weekIndex} className="flex flex-1">
        {Array.from({ length: 7 }, (_, dayIndex) => (
          <div key={dayIndex} className="flex-1 border-r border-b border-gray-200 p-2">
            <div className="w-6 h-4 bg-gray-200 rounded mb-2"></div>
            <div className="space-y-1">
              {Math.random() > 0.7 && (
                <div className="h-3 bg-blue-100 rounded border-l-2 border-blue-300 px-1">
                  <div className="w-full h-1 bg-blue-200 rounded"></div>
                </div>
              )}
              {Math.random() > 0.8 && (
                <div className="h-3 bg-green-100 rounded border-l-2 border-green-300 px-1">
                  <div className="w-3/4 h-1 bg-green-200 rounded"></div>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    ));
    return weeks;
  };

  return (
    <div className="h-full flex animate-pulse" style={{ height }}>
      {/* Sidebar */}
      {showSidebar && (
        <div className="w-64 bg-gray-50 border-r border-gray-200 p-4">
          <div className="mb-4">
            <div className="h-6 bg-gray-200 rounded w-32 mb-2"></div>
            <div className="h-10 bg-gray-200 rounded w-full"></div>
          </div>
          <div className="space-y-2">
            {Array.from({ length: 5 }, (_, i) => (
              <div key={i} className="flex items-center space-x-2">
                <div className="w-4 h-4 bg-gray-200 rounded"></div>
                <div className="flex-1 h-4 bg-gray-200 rounded"></div>
              </div>
            ))}
          </div>
        </div>
      )}
      
      {/* Main calendar area */}
      <div className="flex-1 flex flex-col">
        {/* Header/Toolbar */}
        <div className="h-16 bg-white border-b border-gray-200 flex items-center justify-between px-4">
          <div className="flex items-center space-x-4">
            <CalendarDays className="h-6 w-6 text-gray-300" />
            <div className="h-6 bg-gray-200 rounded w-48"></div>
          </div>
          <div className="flex items-center space-x-2">
            <ChevronLeft className="h-5 w-5 text-gray-300" />
            <div className="h-8 bg-gray-200 rounded w-24"></div>
            <ChevronRight className="h-5 w-5 text-gray-300" />
          </div>
          <div className="flex space-x-2">
            <div className="h-8 bg-gray-200 rounded w-16"></div>
            <div className="h-8 bg-gray-200 rounded w-16"></div>
            <div className="h-8 bg-gray-200 rounded w-16"></div>
          </div>
        </div>
        
        {/* Calendar content */}
        <div className="flex-1 relative overflow-hidden">
          {view === 'month' && (
            <div className="h-full flex flex-col">
              {/* Month header */}
              <div className="h-10 bg-gray-100 border-b border-gray-200 flex">
                {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day) => (
                  <div key={day} className="flex-1 border-r border-gray-200 flex items-center justify-center">
                    <div className="w-8 h-4 bg-gray-200 rounded"></div>
                  </div>
                ))}
              </div>
              {/* Month grid */}
              <div className="flex-1 flex flex-col">
                {generateMonthView()}
              </div>
            </div>
          )}
          
          {view === 'week' && generateWeekView()}
          
          {view === 'day' && (
            <div className="h-full flex">
              <div className="w-16 border-r border-gray-200">
                <div className="h-12 border-b border-gray-200"></div>
                {generateTimeSlots()}
              </div>
              <div className="flex-1">
                <div className="h-12 border-b border-gray-200 flex items-center justify-center">
                  <div className="w-16 h-4 bg-gray-200 rounded mr-2"></div>
                  <div className="w-8 h-8 bg-gray-200 rounded"></div>
                </div>
                {generateTimeSlots()}
              </div>
            </div>
          )}
          
          {/* Loading overlay */}
          <div className="absolute inset-0 bg-white/50 flex items-center justify-center">
            <div className="text-center">
              <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mb-4"></div>
              <p className="text-gray-500">Loading calendar...</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CalendarSkeleton;
