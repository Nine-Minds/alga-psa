'use client'

import React, { useState, useEffect } from 'react';
import { IChangeRequest } from '../../interfaces/change.interfaces';

interface CalendarEvent {
  id: string;
  title: string;
  start: Date;
  end: Date;
  type: 'change' | 'maintenance' | 'blackout';
  status?: string;
  riskLevel?: string;
  changeNumber?: string;
}

interface ChangeCalendarProps {
  tenant: string;
  onEventClick?: (event: CalendarEvent) => void;
  onDateSelect?: (date: Date) => void;
  selectedDate?: Date;
}

export function ChangeCalendar({ 
  tenant, 
  onEventClick, 
  onDateSelect,
  selectedDate 
}: ChangeCalendarProps) {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [viewMode, setViewMode] = useState<'month' | 'week'>('month');

  useEffect(() => {
    loadCalendarData();
  }, [currentDate, viewMode, tenant]);

  const loadCalendarData = async () => {
    setLoading(true);
    try {
      const startDate = getCalendarStartDate();
      const endDate = getCalendarEndDate();
      
      // In real implementation, this would be an API call
      const mockEvents: CalendarEvent[] = [
        {
          id: '1',
          title: 'Database Upgrade',
          start: new Date(2025, 8, 15, 2, 0),
          end: new Date(2025, 8, 15, 6, 0),
          type: 'change',
          status: 'approved',
          riskLevel: 'medium',
          changeNumber: 'CHG-001'
        },
        {
          id: '2',
          title: 'Network Maintenance',
          start: new Date(2025, 8, 20, 1, 0),
          end: new Date(2025, 8, 20, 5, 0),
          type: 'maintenance'
        },
        {
          id: '3',
          title: 'Year-End Freeze',
          start: new Date(2025, 11, 20, 0, 0),
          end: new Date(2026, 0, 5, 23, 59),
          type: 'blackout'
        }
      ];
      
      setEvents(mockEvents);
    } catch (error) {
      console.error('Error loading calendar data:', error);
    } finally {
      setLoading(false);
    }
  };

  const getCalendarStartDate = () => {
    const start = new Date(currentDate);
    if (viewMode === 'month') {
      start.setDate(1);
      start.setDate(start.getDate() - start.getDay()); // Start from Sunday
    } else {
      start.setDate(start.getDate() - start.getDay()); // Start from Sunday
    }
    return start;
  };

  const getCalendarEndDate = () => {
    const end = new Date(currentDate);
    if (viewMode === 'month') {
      end.setMonth(end.getMonth() + 1);
      end.setDate(0); // Last day of current month
      end.setDate(end.getDate() + (6 - end.getDay())); // End on Saturday
    } else {
      end.setDate(end.getDate() + (6 - end.getDay())); // End on Saturday
    }
    return end;
  };

  const getDaysInCalendar = () => {
    const days = [];
    const start = getCalendarStartDate();
    const end = getCalendarEndDate();
    
    const current = new Date(start);
    while (current <= end) {
      days.push(new Date(current));
      current.setDate(current.getDate() + 1);
    }
    
    return days;
  };

  const getEventsForDate = (date: Date) => {
    return events.filter(event => {
      const eventDate = new Date(event.start);
      return eventDate.toDateString() === date.toDateString();
    });
  };

  const getEventTypeColor = (type: string) => {
    switch (type) {
      case 'change':
        return 'bg-blue-500';
      case 'maintenance':
        return 'bg-green-500';
      case 'blackout':
        return 'bg-red-500';
      default:
        return 'bg-gray-500';
    }
  };

  const getRiskLevelColor = (riskLevel?: string) => {
    switch (riskLevel) {
      case 'high':
        return 'border-l-red-500';
      case 'medium':
        return 'border-l-yellow-500';
      case 'low':
        return 'border-l-green-500';
      default:
        return 'border-l-gray-500';
    }
  };

  const navigateCalendar = (direction: 'prev' | 'next') => {
    const newDate = new Date(currentDate);
    if (viewMode === 'month') {
      newDate.setMonth(newDate.getMonth() + (direction === 'next' ? 1 : -1));
    } else {
      newDate.setDate(newDate.getDate() + (direction === 'next' ? 7 : -7));
    }
    setCurrentDate(newDate);
  };

  const formatCalendarTitle = () => {
    if (viewMode === 'month') {
      return currentDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    } else {
      const start = getCalendarStartDate();
      const end = getCalendarEndDate();
      return `${start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${end.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
    }
  };

  const isToday = (date: Date) => {
    const today = new Date();
    return date.toDateString() === today.toDateString();
  };

  const isCurrentMonth = (date: Date) => {
    return date.getMonth() === currentDate.getMonth();
  };

  const isSelected = (date: Date) => {
    return selectedDate && date.toDateString() === selectedDate.toDateString();
  };

  return (
    <div className="bg-white rounded-lg shadow-lg p-6">
      {/* Calendar Header */}
      <div className="flex justify-between items-center mb-6">
        <div className="flex items-center space-x-4">
          <h2 className="text-xl font-semibold text-gray-900">
            Change Calendar
          </h2>
          <div className="flex bg-gray-100 rounded-lg p-1">
            <button
              onClick={() => setViewMode('month')}
              className={`px-3 py-1 rounded text-sm font-medium transition-colors ${
                viewMode === 'month'
                  ? 'bg-white text-blue-600 shadow-sm'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              Month
            </button>
            <button
              onClick={() => setViewMode('week')}
              className={`px-3 py-1 rounded text-sm font-medium transition-colors ${
                viewMode === 'week'
                  ? 'bg-white text-blue-600 shadow-sm'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              Week
            </button>
          </div>
        </div>

        <div className="flex items-center space-x-4">
          <button
            onClick={() => navigateCalendar('prev')}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          
          <h3 className="text-lg font-medium text-gray-900 min-w-[200px] text-center">
            {formatCalendarTitle()}
          </h3>
          
          <button
            onClick={() => navigateCalendar('next')}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-4 mb-6 p-3 bg-gray-50 rounded-lg">
        <div className="flex items-center space-x-2">
          <div className="w-3 h-3 bg-blue-500 rounded"></div>
          <span className="text-sm text-gray-600">Changes</span>
        </div>
        <div className="flex items-center space-x-2">
          <div className="w-3 h-3 bg-green-500 rounded"></div>
          <span className="text-sm text-gray-600">Maintenance</span>
        </div>
        <div className="flex items-center space-x-2">
          <div className="w-3 h-3 bg-red-500 rounded"></div>
          <span className="text-sm text-gray-600">Blackout</span>
        </div>
        <div className="flex items-center space-x-2">
          <div className="w-3 h-3 border-l-4 border-l-red-500 bg-gray-200"></div>
          <span className="text-sm text-gray-600">High Risk</span>
        </div>
        <div className="flex items-center space-x-2">
          <div className="w-3 h-3 border-l-4 border-l-yellow-500 bg-gray-200"></div>
          <span className="text-sm text-gray-600">Medium Risk</span>
        </div>
        <div className="flex items-center space-x-2">
          <div className="w-3 h-3 border-l-4 border-l-green-500 bg-gray-200"></div>
          <span className="text-sm text-gray-600">Low Risk</span>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center items-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
        </div>
      ) : (
        <>
          {/* Calendar Grid */}
          <div className="grid grid-cols-7 gap-1">
            {/* Day headers */}
            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
              <div key={day} className="p-2 text-center text-sm font-medium text-gray-500 bg-gray-50">
                {day}
              </div>
            ))}

            {/* Calendar days */}
            {getDaysInCalendar().map(date => {
              const dayEvents = getEventsForDate(date);
              const isCurrentDay = isToday(date);
              const isSelectedDay = isSelected(date);
              const isCurrentMonthDay = isCurrentMonth(date);

              return (
                <div
                  key={date.toISOString()}
                  className={`min-h-[120px] p-1 border border-gray-200 cursor-pointer transition-colors ${
                    isCurrentDay
                      ? 'bg-blue-50 border-blue-300'
                      : isSelectedDay
                      ? 'bg-blue-100 border-blue-400'
                      : 'hover:bg-gray-50'
                  } ${!isCurrentMonthDay ? 'opacity-50' : ''}`}
                  onClick={() => onDateSelect?.(date)}
                >
                  <div className={`text-sm font-medium mb-1 ${
                    isCurrentDay ? 'text-blue-600' : isCurrentMonthDay ? 'text-gray-900' : 'text-gray-400'
                  }`}>
                    {date.getDate()}
                  </div>

                  <div className="space-y-1">
                    {dayEvents.slice(0, 3).map(event => (
                      <div
                        key={event.id}
                        className={`text-xs p-1 rounded text-white cursor-pointer border-l-2 ${
                          getEventTypeColor(event.type)
                        } ${getRiskLevelColor(event.riskLevel)}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          onEventClick?.(event);
                        }}
                        title={`${event.title} (${event.start.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} - ${event.end.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })})`}
                      >
                        <div className="truncate">
                          {event.changeNumber && (
                            <span className="font-medium">{event.changeNumber}: </span>
                          )}
                          {event.title}
                        </div>
                        <div className="text-xs opacity-75">
                          {event.start.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </div>
                      </div>
                    ))}

                    {dayEvents.length > 3 && (
                      <div className="text-xs text-gray-500 font-medium">
                        +{dayEvents.length - 3} more
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* Today button */}
      <div className="flex justify-center mt-6">
        <button
          onClick={() => setCurrentDate(new Date())}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
        >
          Go to Today
        </button>
      </div>
    </div>
  );
}

export default ChangeCalendar;