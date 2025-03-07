import React, { useEffect, useState } from 'react';
import { TicketActivity } from '../../interfaces/activity.interfaces';
import { Button } from '../ui/Button';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/Card';
import { TicketCard } from './ActivityCard';
import { fetchTicketActivities } from '../../lib/actions/activity-actions/activityServerActions';
import { ActivityDetailsDrawer } from './ActivityDetailsDrawer';

interface TicketsSectionProps {
  limit?: number;
  onViewAll?: () => void;
}

export function TicketsSection({ limit = 5, onViewAll }: TicketsSectionProps) {
  const [activities, setActivities] = useState<TicketActivity[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedActivity, setSelectedActivity] = useState<TicketActivity | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadActivities() {
      try {
        setLoading(true);
        // Fetch ticket activities
        const result = await fetchTicketActivities({
          isClosed: false
        });
        
        // Sort by priority (high to low) and then by due date (ascending)
        const sortedActivities = result.sort((a, b) => {
          // First sort by priority (high to low)
          const priorityOrder = { 
            'high': 0, 
            'medium': 1, 
            'low': 2 
          };
          const priorityDiff = priorityOrder[a.priority] - priorityOrder[b.priority];
          if (priorityDiff !== 0) return priorityDiff;
          
          // Then sort by due date (closest first)
          if (a.dueDate && b.dueDate) {
            return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime();
          } else if (a.dueDate) {
            return -1; // a has due date, b doesn't
          } else if (b.dueDate) {
            return 1; // b has due date, a doesn't
          }
          
          return 0;
        });
        
        setActivities(sortedActivities.slice(0, limit));
        setError(null);
      } catch (err) {
        console.error('Error loading ticket activities:', err);
        setError('Failed to load ticket activities. Please try again later.');
      } finally {
        setLoading(false);
      }
    }
    
    loadActivities();
  }, [limit]);

  const handleViewDetails = (activity: TicketActivity) => {
    setSelectedActivity(activity);
  };

  const handleCloseDrawer = () => {
    setSelectedActivity(null);
  };

  const handleRefresh = async () => {
    try {
      setLoading(true);
      const result = await fetchTicketActivities({
        isClosed: false
      });
      
      const sortedActivities = result.sort((a, b) => {
        const priorityOrder = { 
          'high': 0, 
          'medium': 1, 
          'low': 2 
        };
        const priorityDiff = priorityOrder[a.priority] - priorityOrder[b.priority];
        if (priorityDiff !== 0) return priorityDiff;
        
        if (a.dueDate && b.dueDate) {
          return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime();
        } else if (a.dueDate) {
          return -1;
        } else if (b.dueDate) {
          return 1;
        }
        
        return 0;
      });
      
      setActivities(sortedActivities.slice(0, limit));
      setError(null);
    } catch (err) {
      console.error('Error refreshing ticket activities:', err);
      setError('Failed to refresh ticket activities. Please try again later.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card id="tickets-activities-card">
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle>Tickets</CardTitle>
        <div className="flex items-center gap-2">
          <Button 
            id="refresh-tickets-button" 
            variant="ghost" 
            size="sm"
            onClick={handleRefresh}
            disabled={loading}
          >
            Refresh
          </Button>
          <Button 
            id="view-all-tickets-button" 
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
            <p className="text-gray-500">Loading ticket activities...</p>
          </div>
        ) : error ? (
          <div className="flex justify-center items-center h-40">
            <p className="text-red-500">{error}</p>
          </div>
        ) : activities.length === 0 ? (
          <div className="flex justify-center items-center h-40">
            <p className="text-gray-500">No ticket activities found</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4">
            {activities.map(activity => (
              <TicketCard
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