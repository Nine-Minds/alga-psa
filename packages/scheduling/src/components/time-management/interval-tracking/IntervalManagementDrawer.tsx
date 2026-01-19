import React, { useState, useEffect, useMemo, useCallback } from 'react';
import Drawer from '@alga-psa/ui/components/Drawer';
import { TicketInterval, TicketIntervalGroup } from '@alga-psa/types';
import { IntervalTrackingService } from '@alga-psa/ui/services';
import { IntervalItem } from './IntervalItem';
import { Switch } from '@alga-psa/ui/components/Switch';
import { Label } from '@alga-psa/ui/components/Label';
import { Button } from '@alga-psa/ui/components/Button';
import { Trash, Merge, Clock, TicketCheck } from 'lucide-react';
import { Card } from '@alga-psa/ui/components/Card';
import { formatDuration, calculateTotalDuration, secondsToMinutes, groupIntervalsByTicket } from './utils';
import type { ITimeEntry, ITimePeriodView, TimeSheetStatus } from '@alga-psa/types';
import TimeEntryDialog from '../time-entry/time-sheet/TimeEntryDialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@alga-psa/ui/components/Tabs';
import { Tooltip } from '@alga-psa/ui/components/Tooltip';
import { getCurrentTimePeriod } from '../../../actions/timePeriodsActions';

interface IntervalManagementDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  userId: string;
  onCreateTimeEntry?: (entry: ITimeEntry) => Promise<void>;
}

/**
 * Drawer component for managing time tracking intervals
 */
export function IntervalManagementDrawer({
  isOpen,
  onClose,
  userId,
  onCreateTimeEntry
}: IntervalManagementDrawerProps) {
  const [intervals, setIntervals] = useState<TicketInterval[]>([]);
  const [selectedIntervalIds, setSelectedIntervalIds] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [filterShortIntervals, setFilterShortIntervals] = useState(true);
  const [groupByTicket, setGroupByTicket] = useState(true);
  const [currentTab, setCurrentTab] = useState('all');
  const [isTimeEntryDialogOpen, setIsTimeEntryDialogOpen] = useState(false);
  const [timeEntryData, setTimeEntryData] = useState<Partial<ITimeEntry> | null>(null);
  const [currentTimePeriod, setCurrentTimePeriod] = useState<ITimePeriodView | null>(null);
  
  const intervalService = useMemo(() => new IntervalTrackingService(), []);
  
  // Fetch current time period and create time sheet for use in time entry creation
  useEffect(() => {
    const fetchCurrentPeriod = async () => {
      try {
        const period = await getCurrentTimePeriod();
        setCurrentTimePeriod(period);
        
        // Additional check to ensure we have a valid period
        if (!period) {
          console.error('No current time period available');
          return;
        }
        
        // For time entries, we need a time sheet ID, not just a period ID
        // This action will fetch an existing time sheet or create one if it doesn't exist
        const { fetchOrCreateTimeSheet } = await import('../../../actions/timeEntryActions');
        if (fetchOrCreateTimeSheet && userId && period.period_id) {
          try {
            const timeSheet = await fetchOrCreateTimeSheet(userId, period.period_id);
            console.log('Time sheet fetched/created:', timeSheet);
            // Update the timePeriod object to include the time sheet ID for later use
            setCurrentTimePeriod(prev => prev ? {
              ...prev,
              timeSheetId: timeSheet.id // Store the time sheet ID in the period object
            } : null);
          } catch (error) {
            console.error('Error fetching/creating time sheet:', error);
          }
        }
      } catch (error) {
        console.error('Error fetching current time period:', error);
      }
    };
    
    if (isOpen && userId) {
      fetchCurrentPeriod();
    }
  }, [isOpen, userId]);  // Add userId to dependency array
  
  // Load intervals when drawer opens
  const loadIntervals = useCallback(async () => {
    if (!isOpen || !userId) return;
    
    try {
      setIsLoading(true);
      const userIntervals = await intervalService.getUserIntervals(userId);
      setIntervals(userIntervals);
    } catch (error) {
      console.error('Error loading intervals:', error);
    } finally {
      setIsLoading(false);
    }
  }, [isOpen, userId, intervalService]);
  
  useEffect(() => {
    loadIntervals();
  }, [loadIntervals]);
  
  // Filter intervals based on preferences
  const filteredIntervals = useMemo(() => {
    // Apply duration filter if needed
    let filtered = filterShortIntervals 
      ? intervals.filter(interval => {
          const duration = interval.duration ?? (
            interval.endTime
              ? Math.floor((new Date(interval.endTime).getTime() - new Date(interval.startTime).getTime()) / 1000)
              : Math.floor((new Date().getTime() - new Date(interval.startTime).getTime()) / 1000)
          );
          return duration >= 60; // Filter intervals shorter than 1 minute
        })
      : intervals;
    
    // Apply tab filter
    if (currentTab === 'active') {
      filtered = filtered.filter(interval => !interval.endTime);
    } else if (currentTab === 'closed') {
      filtered = filtered.filter(interval => !!interval.endTime);
    } else if (currentTab === 'auto-closed') {
      filtered = filtered.filter(interval => interval.autoClosed);
    }
    
    return filtered;
  }, [intervals, filterShortIntervals, currentTab]);
  
  // Group intervals by ticket if enabled
  const groupedIntervals = useMemo(() => {
    if (!groupByTicket) {
      return [{ 
        ticketId: 'all', 
        ticketNumber: '',
        ticketTitle: 'All Intervals',
        intervals: filteredIntervals 
      }];
    }
    
    return groupIntervalsByTicket(filteredIntervals);
  }, [filteredIntervals, groupByTicket]);
  
  // Calculate total duration of all filtered intervals
  const totalDuration = useMemo(() => {
    return calculateTotalDuration(filteredIntervals);
  }, [filteredIntervals]);
  
  // Calculate total duration of selected intervals
  const selectedDuration = useMemo(() => {
    const selectedIntervals = filteredIntervals.filter(
      interval => selectedIntervalIds.includes(interval.id)
    );
    return calculateTotalDuration(selectedIntervals);
  }, [filteredIntervals, selectedIntervalIds]);
  
  // Handle interval selection
  const toggleIntervalSelection = (intervalId: string) => {
    setSelectedIntervalIds(prevSelected => {
      if (prevSelected.includes(intervalId)) {
        return prevSelected.filter(id => id !== intervalId);
      } else {
        return [...prevSelected, intervalId];
      }
    });
  };
  
  // Delete selected intervals
  const handleDeleteIntervals = async () => {
    if (selectedIntervalIds.length === 0) return;
    
    try {
      await intervalService.deleteIntervals(selectedIntervalIds);
      setSelectedIntervalIds([]);
      await loadIntervals();
    } catch (error) {
      console.error('Error deleting intervals:', error);
    }
  };
  
  // Merge selected intervals
  const handleMergeIntervals = async () => {
    if (selectedIntervalIds.length < 2) return;
    
    // Check if all selected intervals are from the same ticket
    const selectedIntervals = filteredIntervals.filter(
      interval => selectedIntervalIds.includes(interval.id)
    );
    
    // Check if all selected intervals have the same ticketId
    const ticketId = selectedIntervals[0].ticketId;
    const allSameTicket = selectedIntervals.every(interval => interval.ticketId === ticketId);
    
    if (!allSameTicket) {
      alert('Can only merge intervals from the same ticket');
      return;
    }
    
    try {
      await intervalService.mergeIntervals(selectedIntervalIds);
      setSelectedIntervalIds([]);
      await loadIntervals();
    } catch (error) {
      console.error('Error merging intervals:', error);
    }
  };
  
  // Create time entry from selected intervals
  const handleCreateTimeEntry = () => {
    if (selectedIntervalIds.length === 0) return;
    
    // Check if we have a valid time period first
    if (!currentTimePeriod) {
      alert('Cannot create time entry - no active time period found. Please contact your administrator.');
      return;
    }
    
    // Make sure we have a time sheet ID
    if (!currentTimePeriod.timeSheetId) {
      alert('Cannot create time entry - no time sheet available. Please contact your administrator.');
      console.error('Missing timeSheetId in currentTimePeriod:', currentTimePeriod);
      return;
    }
    
    // Prevent creating time entries from multiple intervals
    if (selectedIntervalIds.length > 1) {
      alert('Please merge intervals first before creating a time entry');
      return;
    }
    
    // Get selected intervals
    const selectedIntervals = filteredIntervals.filter(
      interval => selectedIntervalIds.includes(interval.id)
    );
    
    if (selectedIntervals.length === 0) return;
    
    // Check if all selected intervals are from the same ticket
    const ticketId = selectedIntervals[0].ticketId;
    const allSameTicket = selectedIntervals.every(interval => interval.ticketId === ticketId);
    
    if (!allSameTicket) {
      alert('Can only create time entries from intervals of the same ticket');
      return;
    }
    
    // Find earliest start and latest end
    let earliestStart = new Date(selectedIntervals[0].startTime);
    let latestEnd = selectedIntervals[0].endTime 
      ? new Date(selectedIntervals[0].endTime) 
      : new Date();
    
    selectedIntervals.forEach(interval => {
      const start = new Date(interval.startTime);
      if (start < earliestStart) {
        earliestStart = start;
      }
      
      const end = interval.endTime ? new Date(interval.endTime) : new Date();
      if (end > latestEnd) {
        latestEnd = end;
      }
    });
    
    // Calculate duration in minutes
    const durationSeconds = Math.floor((latestEnd.getTime() - earliestStart.getTime()) / 1000);
    const durationMinutes = secondsToMinutes(durationSeconds);
    
    // Make sure the work_item is in the correct format required by TimeEntryDialog
    const workItem = {
      work_item_id: ticketId,
      type: 'ticket',
      name: `Ticket #${selectedIntervals[0].ticketNumber}`,
      description: selectedIntervals[0].ticketTitle,
      is_billable: true
    };
    
    // Prepare time entry data
    const timeEntry: Partial<ITimeEntry> = {
      work_item_id: ticketId,
      work_item_type: 'ticket',
      start_time: earliestStart.toISOString(),
      end_time: latestEnd.toISOString(),
      billable_duration: durationMinutes,
      notes: `Created from interval for ticket ${selectedIntervals[0].ticketNumber}`,
      user_id: userId,
      time_sheet_id: currentTimePeriod.timeSheetId // Make sure to include the time sheet ID
    };
    
    console.log('Creating time entry with data:', {
      ...timeEntry,
      workItem,
      timePeriod: currentTimePeriod
    });
    
    setTimeEntryData(timeEntry);
    setIsTimeEntryDialogOpen(true);
  };
  
  // Handle saving time entry
  const handleSaveTimeEntry = async (timeEntry: ITimeEntry) => {
    try {
      // Ensure we have the required fields for saving
      const completeTimeEntry = {
        ...timeEntry,
        approval_status: 'DRAFT' as TimeSheetStatus,
        created_at: timeEntry.created_at || new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
      
      // Save time entry using the provided callback
      if (onCreateTimeEntry) {
        await onCreateTimeEntry(completeTimeEntry);
        
        // Delete the intervals that were converted
        await intervalService.deleteIntervals(selectedIntervalIds);
        
        // Reset selection and reload intervals
        setSelectedIntervalIds([]);
        setIsTimeEntryDialogOpen(false);
        setTimeEntryData(null);
        await loadIntervals();
      } else {
        console.error("No callback provided for creating time entry");
        alert("Unable to create time entry. No save handler is available.");
      }
    } catch (error) {
      console.error('Error saving time entry:', error);
      alert(`Failed to save time entry: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };
  
  return (
    <Drawer 
      isOpen={isOpen} 
      onClose={onClose}
    >
      <h2 className="text-xl font-semibold p-4">Ticket Time Intervals</h2>
      <div className="p-4 space-y-4">
        <div className="flex justify-between items-center">
          <div className="flex items-center space-x-4">
            <div className="flex items-center space-x-2">
              <Switch
                id="filter-short-intervals-drawer"
                checked={filterShortIntervals}
                onCheckedChange={setFilterShortIntervals}
              />
              <Label htmlFor="filter-short-intervals-drawer">Hide short intervals</Label>
            </div>
            
            <div className="flex items-center space-x-2">
              <Switch
                id="group-by-ticket"
                checked={groupByTicket}
                onCheckedChange={setGroupByTicket}
              />
              <Label htmlFor="group-by-ticket">Group by ticket</Label>
            </div>
          </div>
          
          <div className="flex items-center gap-3">
            <Button 
              id="select-all-intervals-drawer-button"
              variant="ghost" 
              size="sm" 
              onClick={() => {
                if (selectedIntervalIds.length === filteredIntervals.length) {
                  // If all are selected, deselect all
                  setSelectedIntervalIds([]);
                } else {
                  // Otherwise select all
                  setSelectedIntervalIds(filteredIntervals.map(interval => interval.id));
                }
              }}
            >
              {selectedIntervalIds.length === filteredIntervals.length ? "Deselect All" : "Select All"}
            </Button>
            
            <div className="text-sm text-gray-600">
              Total time: <span className="font-mono">{formatDuration(totalDuration)}</span>
            </div>
          </div>
        </div>
        
        {/* Tab filter */}
        <Tabs value={currentTab} onValueChange={setCurrentTab} className="w-full">
          <TabsList className="grid grid-cols-4 w-full">
            <TabsTrigger value="all" className="all-intervals-tab">All</TabsTrigger>
            <TabsTrigger value="active" className="active-intervals-tab">Active</TabsTrigger>
            <TabsTrigger value="closed" className="closed-intervals-tab">Closed</TabsTrigger>
            <TabsTrigger value="auto-closed" className="auto-closed-intervals-tab">Auto-closed</TabsTrigger>
          </TabsList>
        </Tabs>
        
        {/* Selection actions */}
        {selectedIntervalIds.length > 0 && (
          <Card className="p-3 bg-blue-50">
            <div className="flex items-center justify-between">
              <div>
                <span className="font-medium">{selectedIntervalIds.length} interval{selectedIntervalIds.length !== 1 ? 's' : ''} selected</span>
                <span className="ml-2 text-sm">
                  ({formatDuration(selectedDuration)})
                </span>
              </div>
              
              <div className="flex flex-wrap gap-2 justify-end">
                <Tooltip content="Delete selected intervals">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleDeleteIntervals}
                    className="text-red-600"
                    id="delete-intervals-drawer-button"
                  >
                    <Trash className="h-4 w-4" />
                  </Button>
                </Tooltip>
                
                {selectedIntervalIds.length >= 2 && (
                  <Tooltip content="Merge selected intervals">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleMergeIntervals}
                      id="merge-intervals-drawer-button"
                    >
                      <Merge className="h-4 w-4" />
                    </Button>
                  </Tooltip>
                )}
                
                <Tooltip content="Create time entry from selected intervals">
                  <Button
                    variant="default"
                    size="sm"
                    onClick={handleCreateTimeEntry}
                    id="create-time-entry-drawer-button"
                  >
                    <Clock className="h-4 w-4" />
                  </Button>
                </Tooltip>
              </div>
            </div>
          </Card>
        )}
        
        {/* Time Entry Dialog */}
        {timeEntryData && currentTimePeriod && (
          <TimeEntryDialog
            isOpen={isTimeEntryDialogOpen}
            onClose={() => {
              setIsTimeEntryDialogOpen(false);
              setTimeEntryData(null);
            }}
            workItem={(timeEntryData as any).workItem || {
              work_item_id: timeEntryData.work_item_id || '',
              type: timeEntryData.work_item_type || 'ticket',
              name: 'Ticket Time Entry',
              description: timeEntryData.notes || '',
              is_billable: true
            }}
            date={new Date()}
            existingEntries={[]}
            timePeriod={currentTimePeriod}
            isEditable={true}
            defaultStartTime={new Date(timeEntryData.start_time || '')}
            defaultEndTime={new Date(timeEntryData.end_time || '')}
            timeSheetId={currentTimePeriod.timeSheetId}
            onSave={handleSaveTimeEntry}
            inDrawer={true}
          />
        )}
        
        {/* Intervals list */}
        <div className="space-y-4 h-[calc(100vh-300px)] overflow-y-auto pr-1">
          {isLoading ? (
            <div className="text-center py-8">Loading intervals...</div>
          ) : filteredIntervals.length > 0 ? (
            groupedIntervals.map((group) => (
              <div key={group.ticketId} className="mb-6">
                {group.ticketId !== 'all' && (
                  <div className="flex justify-between items-center mb-2">
                    <div className="flex items-center">
                      <TicketCheck className="h-4 w-4 mr-2 text-blue-500" />
                      <h3 className="font-medium">
                        {group.ticketNumber}: {group.ticketTitle}
                      </h3>
                    </div>
                    <Button
                      id={`select-ticket-intervals-drawer-${group.ticketId}`}
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        const groupIntervalIds = group.intervals.map(interval => interval.id);
                        const allSelected = groupIntervalIds.every(id => selectedIntervalIds.includes(id));
                        
                        if (allSelected) {
                          // If all in this group are selected, deselect them
                          setSelectedIntervalIds(prevSelected => 
                            prevSelected.filter(id => !groupIntervalIds.includes(id))
                          );
                        } else {
                          // Otherwise select all in this group
                          setSelectedIntervalIds(prevSelected => {
                            const filteredSelected = prevSelected.filter(id => 
                              !groupIntervalIds.includes(id)
                            );
                            return [...filteredSelected, ...groupIntervalIds];
                          });
                        }
                      }}
                    >
                      {group.intervals.every(interval => selectedIntervalIds.includes(interval.id))
                        ? "Deselect All"
                        : "Select All"}
                    </Button>
                  </div>
                )}
                
                <div className="space-y-2 pl-1">
                  {group.intervals.map(interval => (
                    <IntervalItem
                      key={interval.id}
                      interval={interval}
                      isSelected={selectedIntervalIds.includes(interval.id)}
                      onSelect={() => toggleIntervalSelection(interval.id)}
                    />
                  ))}
                </div>
              </div>
            ))
          ) : (
            <div className="text-center py-8 text-gray-500">
              {intervals.length > 0
                ? 'No intervals match the current filters'
                : 'No intervals found'}
            </div>
          )}
        </div>
      </div>
    </Drawer>
  );
}
