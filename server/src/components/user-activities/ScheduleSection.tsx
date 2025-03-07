import React, { useEffect, useState } from 'react';
import { ScheduleActivity } from '../../interfaces/activity.interfaces';
import { Button } from '../ui/Button';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/Card';
import { ScheduleCard } from './ActivityCard';
import { fetchScheduleActivities } from '../../lib/actions/activity-actions/activityServerActions';
import { ActivityDetailsDrawer } from './ActivityDetailsDrawer';

interface ScheduleSectionProps {
  limit?: number;
  onViewAll?: () => void;
}

export function ScheduleSection({ limit = 5, onViewAll }: ScheduleSectionProps) {
  const [activities, setActivities] = useState<ScheduleActivity[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedActivity, setSelectedActivity] = useState<ScheduleActivity | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadActivities() {
      try {
        setLoading(true);
        // Fetch schedule activities
        const result = await fetchScheduleActivities({
          isClosed: false,
          // Only fetch activities for the next 30 days
          dateRangeStart: new Date().toISOString(),
          dateRangeEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
        });
        
        // Sort by start date (ascending)
        const sortedActivities = result.sort((a, b) => {
          if (a.startDate && b.startDate) {
            return new Date(a.startDate).getTime() - new Date(b.startDate).getTime();
          }
          return 0;
        });
        
        setActivities(sortedActivities.slice(0, limit));
        setError(null);
      } catch (err) {
        console.error('Error loading schedule activities:', err);
        setError('Failed to load schedule activities. Please try again later.');
      } finally {
        setLoading(false);
      }
    }
    
    loadActivities();
  }, [limit]);

  const handleViewDetails = (activity: ScheduleActivity) => {
    setSelectedActivity(activity);
  };

  const handleCloseDrawer = () => {
    setSelectedActivity(null);
  };

  const handleRefresh = async () => {
    try {
      setLoading(true);
      const result = await fetchScheduleActivities({
        isClosed: false,
        dateRangeStart: new Date().toISOString(),
        dateRangeEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
      });
      
      const sortedActivities = result.sort((a, b) => {
        if (a.startDate && b.startDate) {
          return new Date(a.startDate).getTime() - new Date(b.startDate).getTime();
        }
        return 0;
      });
      
      setActivities(sortedActivities.slice(0, limit));
      setError(null);
    } catch (err) {
      console.error('Error refreshing schedule activities:', err);
      setError('Failed to refresh schedule activities. Please try again later.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card id="schedule-activities-card" className="col-span-1 md:col-span-2">
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle>Schedule</CardTitle>
        <div className="flex items-center gap-2">
          <Button 
            id="refresh-schedule-button" 
            variant="ghost" 
            size="sm"
            onClick={handleRefresh}
            disabled={loading}
          >
            Refresh
          </Button>
          <Button 
            id="view-all-schedule-button" 
            variant="ghost" 
            size="sm"
            onClick={onViewAll}
          >
            View All
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex justify-center items-center h-40">
            <p className="text-gray-500">Loading schedule activities...</p>
          </div>
        ) : error ? (
          <div className="flex justify-center items-center h-40">
            <p className="text-red-500">{error}</p>
          </div>
        ) : activities.length === 0 ? (
          <div className="flex justify-center items-center h-40">
            <p className="text-gray-500">No schedule activities found</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4">
            {activities.map(activity => (
              <ScheduleCard
                key={activity.id}
                activity={activity}
                onViewDetails={() => handleViewDetails(activity)}
              />
            ))}
          </div>
        )}
      </CardContent>

      {/* Activity Details Drawer */}
      {selectedActivity && (
        <ActivityDetailsDrawer
          activity={selectedActivity}
          isOpen={!!selectedActivity}
          onClose={handleCloseDrawer}
          onActionComplete={handleRefresh}
        />
      )}
    </Card>
  );
}