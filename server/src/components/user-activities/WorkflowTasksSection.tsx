import React, { useEffect, useState } from 'react';
import { WorkflowTaskActivity, ActivityType } from '../../interfaces/activity.interfaces';
import { Button } from '../ui/Button';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/Card';
import { WorkflowTaskCard } from './ActivityCard';
import { fetchDashboardWorkflowTasks } from '../../lib/actions/activity-actions/workflowTaskActions';
import { ActivityDetailsDrawer } from './ActivityDetailsDrawer';
import { WorkflowTaskListDrawer } from './WorkflowTaskListDrawer';
import { useDrawer } from '../../context/DrawerContext';

interface WorkflowTasksSectionProps {
  limit?: number;
  onViewAll?: () => void;
}

export function WorkflowTasksSection({ limit = 5, onViewAll }: WorkflowTasksSectionProps) {
  const [activities, setActivities] = useState<WorkflowTaskActivity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const drawer = useDrawer();

  useEffect(() => {
    loadActivities();
  }, [limit]);

  const loadActivities = async () => {
    try {
      setLoading(true);
      // Use the specialized function for dashboard workflow tasks
      const result = await fetchDashboardWorkflowTasks(limit, {
        isClosed: false
      });
      
      setActivities(result);
      setError(null);
    } catch (err) {
      console.error('Error loading workflow task activities:', err);
      setError('Failed to load workflow task activities. Please try again later.');
    } finally {
      setLoading(false);
    }
  };

  const handleViewDetails = (activity: WorkflowTaskActivity) => {
    drawer.openDetailDrawer(
      activity,
      <ActivityDetailsDrawer
        activity={activity}
        isOpen={true}
        onClose={drawer.closeDrawer}
        onActionComplete={() => {
          // First close the drawer
          drawer.closeDrawer();
          
          // Then refresh the activities list
          loadActivities();
        }}
      />,
      activity.title
    );
  };

  const handleViewAll = () => {
    if (onViewAll) {
      onViewAll();
      return;
    }

    drawer.openListDrawer(
      ActivityType.WORKFLOW_TASK,
      'Workflow Tasks',
      <WorkflowTaskListDrawer
        onSelectTask={(task) => {
          // First close the list drawer
          drawer.closeDrawer();
          
          // Then open the detail drawer after a short delay
          setTimeout(() => {
            handleViewDetails(task);
          }, 100);
        }}
      />
    );
  };

  return (
    <Card id="workflow-tasks-activities-card" className="col-span-1 md:col-span-2">
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle>Workflow Tasks</CardTitle>
        <div className="flex items-center gap-2">
          <Button
            id="refresh-workflow-tasks-button"
            variant="ghost"
            size="sm"
            onClick={loadActivities}
            disabled={loading}
          >
            Refresh
          </Button>
          <Button
            id="view-all-workflow-tasks-button"
            variant="ghost"
            size="sm"
            onClick={handleViewAll}
          >
            View All
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex justify-center items-center h-40">
            <p className="text-gray-500">Loading workflow task activities...</p>
          </div>
        ) : error ? (
          <div className="flex justify-center items-center h-40">
            <p className="text-red-500">{error}</p>
          </div>
        ) : activities.length === 0 ? (
          <div className="flex justify-center items-center h-40">
            <p className="text-gray-500">No workflow task activities found</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {activities.map(activity => (
              <WorkflowTaskCard
                key={activity.id}
                activity={activity}
                onViewDetails={() => handleViewDetails(activity)}
              />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}