import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { toast } from 'react-hot-toast';
import { TicketInterval, TicketIntervalGroup } from '@alga-psa/types';
import { IntervalTrackingService } from '@alga-psa/ui/services';
import { IntervalItem } from './IntervalItem';
import { formatDuration, calculateTotalDuration, secondsToMinutes, groupIntervalsByTicket } from './utils';
import { Button } from '@alga-psa/ui/components/Button';
import { Card } from '@alga-psa/ui/components/Card';
import { Clock, TicketCheck, Trash } from 'lucide-react';
import type { ITimeEntry, ITimePeriodView, ITimeSheet } from '@alga-psa/types';
import { fetchOrCreateTimeSheet } from '../../../actions/timeEntryActions';
import TimeEntryDialog from '../time-entry/time-sheet/TimeEntryDialog';
import { Tooltip } from '@alga-psa/ui/components/Tooltip';

function parseLocalDate(dateStr: string): Date {
  const [year, month, day] = dateStr.slice(0, 10).split('-').map(Number);
  return new Date(year, month - 1, day);
}

interface IntervalSectionProps {
  userId: string;
  timePeriod: ITimePeriodView;
  onCreateTimeEntry: (timeEntry: ITimeEntry) => Promise<void>;
}

/**
 * Component for displaying and managing intervals within a time sheet
 */
export function IntervalSection({
  userId,
  timePeriod,
  onCreateTimeEntry
}: IntervalSectionProps): React.JSX.Element {
  const [intervals, setIntervals] = useState<TicketInterval[]>([]);
  const [selectedIntervalIds, setSelectedIntervalIds] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isTimeEntryDialogOpen, setIsTimeEntryDialogOpen] = useState(false);
  const [timeEntryData, setTimeEntryData] = useState<Partial<ITimeEntry> | null>(null);
  const [timeSheet, setTimeSheet] = useState<ITimeSheet | null>(null);
  
  const intervalService = useMemo(() => new IntervalTrackingService(), []);
  
  // Load intervals for this time period
  const loadIntervals = useCallback(async () => {
    try {
      setIsLoading(true);
      const allIntervals = await intervalService.getUserIntervals(userId);
      
      // Filter intervals that fall within the time period
      const startDate = parseLocalDate(timePeriod.start_date);
      const endDate = parseLocalDate(timePeriod.end_date);
      
      const filteredIntervals = allIntervals.filter(interval => {
        const intervalStart = new Date(interval.startTime);
        // Periods are treated as half-open: [start_date, end_date)
        return intervalStart >= startDate && intervalStart < endDate;
      });
      
      setIntervals(filteredIntervals);
    } catch (error) {
      console.error('Error loading intervals:', error);
    } finally {
      setIsLoading(false);
    }
  }, [userId, timePeriod, intervalService]);
  
  useEffect(() => {
    loadIntervals();
  }, [loadIntervals]);
  
  // Group intervals by ticket
  const groupedIntervals = useMemo(() => {
    return groupIntervalsByTicket(intervals);
  }, [intervals]);
  
  // Calculate total duration of all intervals
  const totalDuration = useMemo(() => {
    return calculateTotalDuration(intervals);
  }, [intervals]);
  
  // Calculate total duration of selected intervals
  const selectedDuration = useMemo(() => {
    const selectedIntervals = intervals.filter(
      interval => selectedIntervalIds.includes(interval.id)
    );
    return calculateTotalDuration(selectedIntervals);
  }, [intervals, selectedIntervalIds]);
  
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
  
  // Fetch or create a time sheet for the given period
  useEffect(() => {
    const getTimeSheet = async () => {
      if (!userId || !timePeriod || !timePeriod.period_id) return;
      
      try {
        const sheet = await fetchOrCreateTimeSheet(userId, timePeriod.period_id);
        setTimeSheet(sheet);
        
        // Update timePeriod with timeSheetId for use in TimeEntryDialog
        const updatedTimePeriod = {
          ...timePeriod,
          timeSheetId: sheet.id
        };
        
        // We can't update the prop directly, but we can log it for debugging
        console.log('Updated timePeriod with timeSheetId:', updatedTimePeriod);
      } catch (error) {
        console.error('Error fetching/creating time sheet:', error);
      }
    };
    
    getTimeSheet();
  }, [userId, timePeriod]);

  // Create time entry from selected intervals
  const handleCreateTimeEntry = async () => {
    if (selectedIntervalIds.length === 0) return;
    
    // Ensure we have a time sheet
    if (!timeSheet) {
      try {
        const sheet = await fetchOrCreateTimeSheet(userId, timePeriod.period_id);
        setTimeSheet(sheet);
      } catch (error) {
        console.error('Error fetching/creating time sheet:', error);
        alert('Cannot create time entry - could not find or create time sheet');
        return;
      }
    }
    
    // Prevent creating time entries from multiple intervals
    if (selectedIntervalIds.length > 1) {
      alert('Please merge intervals first before creating a time entry');
      return;
    }
    
    // Get selected intervals
    const selectedIntervals = intervals.filter(
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
    
    // Prepare time entry data with time_sheet_id
    const timeEntry: Partial<ITimeEntry> = {
      work_item_id: ticketId,
      work_item_type: 'ticket',
      start_time: earliestStart.toISOString(),
      end_time: latestEnd.toISOString(),
      billable_duration: durationMinutes,
      notes: `Created from interval for ticket ${selectedIntervals[0].ticketNumber}`,
      user_id: userId,
      time_sheet_id: timeSheet?.id // Include the time sheet ID
    };
    
    console.log('Creating time entry with data:', {
      ...timeEntry,
      timeSheetId: timeSheet?.id
    });
    
    // Ensure the work item is properly set
    const updatedTimeEntry = {
      ...timeEntry,
      workItem
    };
    
    setTimeEntryData(updatedTimeEntry);
    setIsTimeEntryDialogOpen(true);
  };
  
  // Handle saving time entry
  const handleSaveTimeEntry = async (timeEntry: ITimeEntry) => {
    try {
      // Save time entry using the provided callback
      await onCreateTimeEntry(timeEntry);
      
      // Delete the intervals that were converted
      await intervalService.deleteIntervals(selectedIntervalIds);
      
      // Reset selection and reload intervals
      setSelectedIntervalIds([]);
      setIsTimeEntryDialogOpen(false);
      setTimeEntryData(null);
      await loadIntervals();
    } catch (error) {
      console.error('Error saving time entry:', error);
    }
  };
  
  return (
    <div className="bg-white rounded-lg shadow p-4" id="timesheet-intervals-section">
      <div className="flex justify-between items-center mb-4">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold">Ticket Time Intervals</h2>
          <div className="flex gap-2">
            <Button 
              id="select-all-intervals-button"
              variant="ghost" 
              size="sm" 
              onClick={() => {
                if (selectedIntervalIds.length === intervals.length) {
                  // If all are selected, deselect all
                  setSelectedIntervalIds([]);
                } else {
                  // Otherwise select all
                  setSelectedIntervalIds(intervals.map(interval => interval.id));
                }
              }}
            >
              {selectedIntervalIds.length === intervals.length ? "Deselect All" : "Select All"}
            </Button>
          </div>
        </div>
        <div className="flex items-center">
          <span className="text-sm text-gray-600 mr-4">
            Total time: <span className="font-mono">{formatDuration(totalDuration)}</span>
          </span>
          <Tooltip content="Create time entry from selected intervals">
            <Button
              disabled={selectedIntervalIds.length === 0}
              onClick={handleCreateTimeEntry}
              id="timesheet-create-time-entry-button"
              size="sm"
            >
              <Clock className="h-4 w-4" />
            </Button>
          </Tooltip>
        </div>
      </div>
      
      {/* Selection actions */}
      {selectedIntervalIds.length > 0 && (
        <Card className="p-3 bg-blue-50 mb-4">
          <div className="flex items-center justify-between">
            <div>
              <span className="font-medium">{selectedIntervalIds.length} interval{selectedIntervalIds.length !== 1 ? 's' : ''} selected</span>
              <span className="ml-2 text-sm">
                ({formatDuration(selectedDuration)})
              </span>
            </div>
            
            <div className="flex flex-wrap gap-2 justify-end">
              {selectedIntervalIds.length >= 2 && (
                <Tooltip content="Merge selected intervals">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={async () => {
                      try {
                        // Verify all intervals are from the same ticket
                        const selectedIntervals = intervals.filter(interval => selectedIntervalIds.includes(interval.id));
                        const firstTicketId = selectedIntervals[0].ticketId;
                        const allSameTicket = selectedIntervals.every(interval => interval.ticketId === firstTicketId);
                        
                        if (!allSameTicket) {
                          alert('Can only merge intervals from the same ticket');
                          return;
                        }
                        
                        // Merge intervals
                        const merged = await intervalService.mergeIntervals(selectedIntervalIds);
                        if (merged) {
                          setSelectedIntervalIds([]);
                          toast.success('Intervals merged successfully');
                          await loadIntervals();
                        }
                      } catch (error) {
                        console.error('Error merging intervals:', error);
                        toast.error('Failed to merge intervals');
                      }
                    }}
                    id="timesheet-merge-intervals-button"
                  >
                    Merge
                  </Button>
                </Tooltip>
              )}
              <Tooltip content="Delete selected intervals">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleDeleteIntervals}
                  className="text-red-600"
                  id="timesheet-delete-intervals-button"
                >
                  <Trash className="h-4 w-4" />
                </Button>
              </Tooltip>
            </div>
          </div>
        </Card>
      )}
      
      {/* Intervals list */}
      {isLoading ? (
        <div className="text-center py-8">Loading intervals...</div>
      ) : groupedIntervals.length > 0 ? (
        <div className="space-y-4">
          {groupedIntervals.map(group => (
            <div key={group.ticketId} className="border rounded p-3">
              <div className="flex justify-between items-center mb-2">
                <div className="flex items-center">
                  <TicketCheck className="h-4 w-4 mr-2 text-blue-500" />
                  <h3 className="font-medium">
                    {group.ticketNumber}: {group.ticketTitle}
                  </h3>
                </div>
                <Button
                  id={`select-ticket-intervals-${group.ticketId}`}
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
          ))}
        </div>
      ) : (
        <div className="text-center py-8 text-gray-500">
          No intervals found for this time period
        </div>
      )}
      
      {/* Time Entry Dialog */}
      {timeEntryData && (
        <TimeEntryDialog
          isOpen={isTimeEntryDialogOpen}
          onClose={() => {
            setTimeEntryData(null);
            setIsTimeEntryDialogOpen(false)
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
          timePeriod={timePeriod}
          isEditable={true}
          defaultStartTime={new Date(timeEntryData.start_time || '')}
          defaultEndTime={new Date(timeEntryData.end_time || '')}
          timeSheetId={timeSheet?.id || ""}
          onSave={handleSaveTimeEntry}
          inDrawer={false}
        />
      )}
    </div>
  );
}
