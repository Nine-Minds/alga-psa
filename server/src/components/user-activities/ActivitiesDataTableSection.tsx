import React, { useEffect, useState } from 'react';
import { 
  Activity, 
  ActivityFilters, 
  ActivityType 
} from '../../interfaces/activity.interfaces';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/Card';
import { Button } from '../ui/Button';
import { RefreshCw, Filter } from 'lucide-react';
import { fetchActivities } from '../../lib/actions/activity-actions/activityServerActions';
import { ActivityDetailsDrawer } from './ActivityDetailsDrawer';
import { ActivitiesDataTable } from './ActivitiesDataTable';
import { ActivityFilters as ActivityFiltersComponent } from './ActivityFilters';

interface ActivitiesDataTableSectionProps {
  title?: string;
  initialFilters?: ActivityFilters;
  id?: string;
}

export function ActivitiesDataTableSection({ 
  title = "All Activities", 
  initialFilters = {}, 
  id = "activities-data-table-section" 
}: ActivitiesDataTableSectionProps) {
  const [activities, setActivities] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedActivity, setSelectedActivity] = useState<Activity | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<ActivityFilters>(initialFilters);
  const [showFilters, setShowFilters] = useState(false);

  useEffect(() => {
    loadActivities();
  }, [filters]);

  const loadActivities = async () => {
    try {
      setLoading(true);
      // Prepare filter to ensure we get activities of all types if none specified
      const effectiveFilters = {
        ...filters,
        // If types array is empty, explicitly request all activity types
        types: filters.types && filters.types.length > 0 
          ? filters.types 
          : Object.values(ActivityType)
      };
      
      console.log('Loading activities with filters:', effectiveFilters);
      
      // Fetch activities with effective filters
      const result = await fetchActivities(effectiveFilters);
      console.log(`Loaded ${result.activities.length} activities`);
      setActivities(result.activities);
      setError(null);
    } catch (err) {
      console.error('Error loading activities:', err);
      setError('Failed to load activities. Please try again later.');
    } finally {
      setLoading(false);
    }
  };

  const handleViewDetails = (activity: Activity) => {
    setSelectedActivity(activity);
  };

  const handleCloseDrawer = () => {
    setSelectedActivity(null);
  };

  const handleRefresh = () => {
    loadActivities();
  };

  const handleFilterChange = (newFilters: ActivityFilters) => {
    setFilters(prev => ({
      ...prev,
      ...newFilters
    }));
  };

  const handleToggleFilters = () => {
    setShowFilters(!showFilters);
  };

  return (
    <Card id={id}>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle>{title}</CardTitle>
        <div className="flex items-center gap-2">
          <Button 
            id={`${id}-filter-button`} 
            variant="outline" 
            size="sm"
            onClick={handleToggleFilters}
          >
            <Filter className="h-4 w-4 mr-2" />
            Filters
          </Button>
          <Button 
            id={`${id}-refresh-button`} 
            variant="outline" 
            size="sm"
            onClick={handleRefresh}
            disabled={loading}
          >
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {showFilters && (
          <div className="mb-4">
            <ActivityFiltersComponent
              filters={filters}
              onChange={handleFilterChange}
            />
          </div>
        )}
        
        {loading ? (
          <div className="flex justify-center items-center h-40">
            <p className="text-gray-500">Loading activities...</p>
          </div>
        ) : error ? (
          <div className="flex justify-center items-center h-40">
            <p className="text-red-500">{error}</p>
          </div>
        ) : activities.length === 0 ? (
          <div className="flex justify-center items-center h-40">
            <p className="text-gray-500">No activities found</p>
          </div>
        ) : (
          <ActivitiesDataTable
            activities={activities}
            onViewDetails={handleViewDetails}
            onActionComplete={handleRefresh}
            isLoading={loading}
          />
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