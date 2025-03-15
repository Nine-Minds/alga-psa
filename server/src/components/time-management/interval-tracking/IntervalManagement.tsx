import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { TicketInterval } from '../../../types/interval-tracking';
import { IntervalTrackingService } from '../../../services/IntervalTrackingService';
import { IntervalItem } from './IntervalItem';
import { formatDuration, calculateTotalDuration, secondsToMinutes } from './utils';
import { Button } from '../../ui/Button';
import { Pencil, Trash, Play, Clock, Merge } from 'lucide-react';
import { Card } from '../../ui/Card';
import { Switch } from '../../ui/Switch';
import { Label } from '../../ui/Label';
import { Tooltip } from '../../ui/Tooltip';
import { ITimeEntry } from '../../../interfaces/timeEntry.interfaces';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../../ui/Dialog';
import TimeEntryDialog from '../../time-management/time-entry/time-sheet/TimeEntryDialog';

interface IntervalManagementProps {
  ticketId: string;
  userId: string;
  onCreateTimeEntry?: (entry: ITimeEntry) => void;
}

/**
 * Component for managing time tracking intervals for a specific ticket
 */
export function IntervalManagement({
  ticketId,
  userId,
  onCreateTimeEntry
}: IntervalManagementProps) {
  const [intervals, setIntervals] = useState<TicketInterval[]>([]);
  const [selectedIntervalIds, setSelectedIntervalIds] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [filterShortIntervals, setFilterShortIntervals] = useState(true);
  const [isTimeEntryDialogOpen, setIsTimeEntryDialogOpen] = useState(false);
  const [timeEntryData, setTimeEntryData] = useState<Partial<ITimeEntry> | null>(null);
  
  const intervalService = useMemo(() => new IntervalTrackingService(), []);
  
  // Load intervals for this ticket
  const loadIntervals = useCallback(async () => {
    try {
      setIsLoading(true);
      const ticketIntervals = await intervalService.getIntervalsByTicket(ticketId);
      
      // Sort by start time (most recent first)
      ticketIntervals.sort((a, b) => {
        return new Date(b.startTime).getTime() - new Date(a.startTime).getTime();
      });
      
      setIntervals(ticketIntervals);
    } catch (error) {
      console.error('Error loading intervals:', error);
    } finally {
      setIsLoading(false);
    }
  }, [ticketId, intervalService]);
  
  useEffect(() => {
    loadIntervals();
  }, [loadIntervals]);
  
  // Filter out short intervals if needed
  const filteredIntervals = useMemo(() => {
    if (!filterShortIntervals) return intervals;
    
    return intervals.filter(interval => {
      const duration = interval.duration ?? (
        interval.endTime
          ? Math.floor((new Date(interval.endTime).getTime() - new Date(interval.startTime).getTime()) / 1000)
          : Math.floor((new Date().getTime() - new Date(interval.startTime).getTime()) / 1000)
      );
      
      return duration >= 60; // Filter intervals shorter than 1 minute
    });
  }, [intervals, filterShortIntervals]);
  
  // Calculate total duration of all intervals
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
    
    // Get selected intervals
    const selectedIntervals = filteredIntervals.filter(
      interval => selectedIntervalIds.includes(interval.id)
    );
    
    if (selectedIntervals.length === 0) return;
    
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
    
    // Prepare time entry data
    const timeEntry: Partial<ITimeEntry> = {
      work_item_id: ticketId,
      work_item_type: 'ticket',
      start_time: earliestStart.toISOString(),
      end_time: latestEnd.toISOString(),
      billable_duration: durationMinutes,
      notes: `Created from ${selectedIntervals.length} interval${selectedIntervals.length !== 1 ? 's' : ''}`,
      user_id: userId
    };
    
    setTimeEntryData(timeEntry);
    setIsTimeEntryDialogOpen(true);
  };
  
  // Handle saving time entry
  const handleSaveTimeEntry = async (timeEntry: ITimeEntry) => {
    try {
      // Save time entry using the provided callback
      if (onCreateTimeEntry) {
        await onCreateTimeEntry(timeEntry);
      }
      
      // Delete the intervals that were converted
      await intervalService.deleteIntervals(selectedIntervalIds);
      
      // Reset selection and reload intervals
      setSelectedIntervalIds([]);
      setIsTimeEntryDialogOpen(false);
      await loadIntervals();
    } catch (error) {
      console.error('Error saving time entry:', error);
    }
  };
  
  return (
    <div className="space-y-4" id="ticket-intervals-management">
      <div className="flex justify-between items-center">
        <div className="flex items-center space-x-2">
          <Switch
            id="filter-short-intervals"
            checked={filterShortIntervals}
            onCheckedChange={setFilterShortIntervals}
          />
          <Label htmlFor="filter-short-intervals">Hide intervals under 1 minute</Label>
        </div>
        
        <div className="text-sm text-gray-600">
          Total time: <span className="font-mono">{formatDuration(totalDuration)}</span>
        </div>
      </div>
      
      {/* Action buttons */}
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
                  id="delete-intervals-button"
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
                    id="merge-intervals-button"
                  >
                    <Merge className="h-4 w-4" />
                  </Button>
                </Tooltip>
              )}
              
              <Tooltip content="Create time entry from selected intervals">
                <Button
                  size="sm"
                  onClick={handleCreateTimeEntry}
                  id="create-time-entry-button"
                >
                  <Clock className="h-4 w-4" />
                </Button>
              </Tooltip>
            </div>
          </div>
        </Card>
      )}
      
      {/* Intervals list */}
      <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
        {isLoading ? (
          <div className="text-center py-8">Loading intervals...</div>
        ) : filteredIntervals.length > 0 ? (
          filteredIntervals.map(interval => (
            <IntervalItem
              key={interval.id}
              interval={interval}
              isSelected={selectedIntervalIds.includes(interval.id)}
              onSelect={() => toggleIntervalSelection(interval.id)}
            />
          ))
        ) : (
          <div className="text-center py-8 text-gray-500">
            {intervals.length > 0 && filterShortIntervals
              ? 'No intervals longer than 1 minute found'
              : 'No intervals found for this ticket'}
          </div>
        )}
      </div>
      
      {/* Time Entry Dialog */}
      {timeEntryData && (
        <TimeEntryDialog
          isOpen={isTimeEntryDialogOpen}
          onClose={() => setIsTimeEntryDialogOpen(false)}
          workItem={{
            work_item_id: timeEntryData.work_item_id || '',
            type: timeEntryData.work_item_type || 'ticket',
            name: 'Ticket Time Entry',
            description: timeEntryData.notes || '',
            is_billable: true
          }}
          date={new Date()}
          existingEntries={[]}
          timePeriod={{
            period_id: '',
            start_date: new Date().toISOString(),
            end_date: new Date().toISOString()
          }}
          isEditable={true}
          defaultStartTime={new Date(timeEntryData.start_time || '')}
          defaultEndTime={new Date(timeEntryData.end_time || '')}
          timeSheetId=""
          onSave={handleSaveTimeEntry}
          inDrawer={true}
        />
      )}
    </div>
  );
}