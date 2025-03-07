import React, { useEffect, useState } from 'react';
import { ProjectTaskActivity } from '../../interfaces/activity.interfaces';
import { Button } from '../ui/Button';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/Card';
import { ProjectTaskCard } from './ActivityCard';
import { fetchProjectActivities } from '../../lib/actions/activity-actions/activityServerActions';
import { ActivityDetailsDrawer } from './ActivityDetailsDrawer';

interface ProjectsSectionProps {
  limit?: number;
  onViewAll?: () => void;
}

export function ProjectsSection({ limit = 5, onViewAll }: ProjectsSectionProps) {
  const [activities, setActivities] = useState<ProjectTaskActivity[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedActivity, setSelectedActivity] = useState<ProjectTaskActivity | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadActivities() {
      try {
        setLoading(true);
        // Fetch project activities
        const result = await fetchProjectActivities({
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
        console.error('Error loading project activities:', err);
        setError('Failed to load project activities. Please try again later.');
      } finally {
        setLoading(false);
      }
    }
    
    loadActivities();
  }, [limit]);

  const handleViewDetails = (activity: ProjectTaskActivity) => {
    setSelectedActivity(activity);
  };

  const handleCloseDrawer = () => {
    setSelectedActivity(null);
  };

  const handleRefresh = async () => {
    try {
      setLoading(true);
      const result = await fetchProjectActivities({
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
      console.error('Error refreshing project activities:', err);
      setError('Failed to refresh project activities. Please try again later.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card id="projects-activities-card">
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle>Project Tasks</CardTitle>
        <div className="flex items-center gap-2">
          <Button 
            id="refresh-projects-button" 
            variant="ghost" 
            size="sm"
            onClick={handleRefresh}
            disabled={loading}
          >
            Refresh
          </Button>
          <Button 
            id="view-all-projects-button" 
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
            <p className="text-gray-500">Loading project activities...</p>
          </div>
        ) : error ? (
          <div className="flex justify-center items-center h-40">
            <p className="text-red-500">{error}</p>
          </div>
        ) : activities.length === 0 ? (
          <div className="flex justify-center items-center h-40">
            <p className="text-gray-500">No project activities found</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4">
            {activities.map(activity => (
              <ProjectTaskCard
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