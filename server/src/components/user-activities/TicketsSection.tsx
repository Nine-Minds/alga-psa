import React, { useEffect, useState, useCallback } from 'react';
import { TicketActivity, ActivityFilters } from '../../interfaces/activity.interfaces';
import { ICompany } from '../../interfaces/company.interfaces';
import { IContact } from '../../interfaces/contact.interfaces';
import { IStatus } from '../../interfaces/status.interface';
import { Button } from '../ui/Button';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/Card';
import { TicketCard } from './ActivityCard';
import { fetchTicketActivities } from '../../lib/actions/activity-actions/activityServerActions';
import { getAllCompanies } from '../../lib/actions/companyActions';
import { getAllContacts } from '../../lib/actions/contact-actions/contactActions';
import { getTicketStatuses } from '../../lib/actions/status-actions/statusActions';
import { ActivityDetailsDrawer } from './ActivityDetailsDrawer';
import { TicketSectionFiltersDialog } from './TicketSectionFiltersDialog';
import { Filter, X } from 'lucide-react';
interface TicketsSectionProps {
  limit?: number;
  onViewAll?: () => void;
}

export function TicketsSection({ limit = 5, onViewAll }: TicketsSectionProps) {
  const [activities, setActivities] = useState<TicketActivity[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedActivity, setSelectedActivity] = useState<TicketActivity | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isFilterDialogOpen, setIsFilterDialogOpen] = useState(false);
  const [ticketFilters, setTicketFilters] = useState<Partial<ActivityFilters>>({ isClosed: false });
  const [companies, setCompanies] = useState<ICompany[]>([]);
  const [contacts, setContacts] = useState<IContact[]>([]);
  const [statuses, setStatuses] = useState<IStatus[]>([]);
  const [filterDataLoading, setFilterDataLoading] = useState(true);

  // Fetch initial activities and filter data
  const loadActivities = useCallback(async (filters: Partial<ActivityFilters>) => {
    try {
      setLoading(true);
      setError(null);
      // Fetch ticket activities using current filters
      const result = await fetchTicketActivities(filters);
        
      // Sort by priority (high to low) and then by due date (ascending)
      const sortedActivities = result.sort((a: TicketActivity, b: TicketActivity) => { // Added types
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
    } catch (err) {
      console.error('Error loading ticket activities:', err);
      setError('Failed to load ticket activities. Please try again later.');
    } finally {
      setLoading(false);
    }
  }, [limit]); // Removed dependency on ticketFilters to avoid loop, loadActivities is called explicitly

  // Fetch filter options (companies, contacts) on mount
  useEffect(() => {
    async function loadFilterData() {
      try {
        setFilterDataLoading(true);
        const [companyData, contactData, statusData] = await Promise.all([
          getAllCompanies(false),
          getAllContacts('active'),
          getTicketStatuses() // Fetch ticket statuses
        ]);
        setCompanies(companyData);
        setContacts(contactData);
        setStatuses(statusData); // Set statuses state
      } catch (err) {
        console.error('Error loading filter data:', err);
        // Optionally set an error state for filter data loading
      } finally {
        setFilterDataLoading(false);
      }
    }
    loadFilterData();
  }, []);

  // Load activities initially and when filters change
  useEffect(() => {
    loadActivities(ticketFilters);
  }, [ticketFilters, loadActivities]); // Depend on ticketFilters and the loadActivities function itself

  const handleViewDetails = (activity: TicketActivity) => {
    setSelectedActivity(activity);
  };

  const handleCloseDrawer = () => {
    setSelectedActivity(null);
  };

  const handleRefresh = () => {
    // Reload activities with the current filters
    loadActivities(ticketFilters);
  };

  const handleApplyFilters = (newFilters: Partial<ActivityFilters>) => {
    setTicketFilters(prevFilters => ({
      ...prevFilters, // Keep existing non-ticket filters if any
      ...newFilters, // Apply new ticket-specific filters
    }));
    // loadActivities will be triggered by the useEffect watching ticketFilters
  };

  // Function to check if filters are active (beyond the default)
  const isFiltersActive = useCallback(() => {
    const defaultFilters: Partial<ActivityFilters> = { isClosed: false };
    // Check if any filter key exists beyond the default 'isClosed'
    const hasExtraKeys = Object.keys(ticketFilters).some(key => !(key in defaultFilters));
    // Check if 'isClosed' is different from the default
    const isClosedChanged = ticketFilters.isClosed !== defaultFilters.isClosed;
    // Check if any filter value is actually set (not undefined or empty array for array types)
    const hasSetValues = Object.entries(ticketFilters).some(([key, value]) => {
        if (key === 'isClosed') return value !== false; // Check if isClosed is true
        if (Array.isArray(value)) return value.length > 0; // Check array filters
        return value !== undefined && value !== null && value !== ''; // Check other filters
    });

    // Consider filters active if they have extra keys, isClosed is true, or any value is set meaningfully
    return hasExtraKeys || isClosedChanged || hasSetValues;
  }, [ticketFilters]);


  const handleResetFilters = () => {
    setTicketFilters({ isClosed: false }); // Reset to default filters
    // loadActivities will be triggered by the useEffect watching ticketFilters
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
            aria-label="Refresh Tickets"
          >
            Refresh
          </Button>
          {isFiltersActive() ? (
             <Button
               id="reset-ticket-filters-button"
               variant="ghost"
               size="sm"
               onClick={handleResetFilters}
               disabled={loading}
               aria-label="Reset Filters"
               className="text-red-600 hover:text-red-700"
             >
               <X size={16} className="mr-1" /> Reset Filters
             </Button>
           ) : (
             <Button
               id="filter-tickets-button"
               variant="ghost"
               size="sm"
               onClick={() => setIsFilterDialogOpen(true)}
               disabled={filterDataLoading || loading}
               aria-label="Filter Tickets"
             >
               <Filter size={16} className="mr-1" /> Filter
             </Button>
           )}
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
      {isFilterDialogOpen && (
        <TicketSectionFiltersDialog
          isOpen={isFilterDialogOpen}
          onOpenChange={setIsFilterDialogOpen}
          initialFilters={ticketFilters}
          onApplyFilters={handleApplyFilters}
          companies={companies}
          contacts={contacts}
          statuses={statuses}
        />
      )}
    </Card>
  );
}