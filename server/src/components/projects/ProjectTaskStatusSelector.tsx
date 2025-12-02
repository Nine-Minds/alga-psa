'use client';

import { useState, useEffect } from 'react';
import { IStatus } from 'server/src/interfaces/status.interface';
import { Button } from 'server/src/components/ui/Button';
import { ChevronUp, ChevronDown, Plus, X, ChevronRight, Circle } from 'lucide-react';
import { QuickAddStatus } from 'server/src/components/ui/QuickAddStatus';

interface ProjectTaskStatusSelectorProps {
  availableStatuses: IStatus[];
  selectedStatuses: Array<{ status_id: string; display_order: number }>;
  onChange: (statuses: Array<{ status_id: string; display_order: number }>) => void;
  onStatusCreated?: (status: IStatus) => void;
  error?: string;
}

export function ProjectTaskStatusSelector({
  availableStatuses,
  selectedStatuses,
  onChange,
  onStatusCreated,
  error
}: ProjectTaskStatusSelectorProps) {
  const [showAvailableList, setShowAvailableList] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [showQuickAddStatus, setShowQuickAddStatus] = useState(false);

  // Get status details by ID
  const getStatusDetails = (statusId: string) => {
    return availableStatuses.find(s => s.status_id === statusId);
  };

  // Add a status to the selection
  const addStatus = (statusId: string) => {
    if (selectedStatuses.find(s => s.status_id === statusId)) {
      return; // Already added
    }

    const maxOrder = selectedStatuses.length > 0
      ? Math.max(...selectedStatuses.map(s => s.display_order))
      : 0;

    onChange([
      ...selectedStatuses,
      { status_id: statusId, display_order: maxOrder + 1 }
    ]);
  };

  // Remove a status from the selection
  const removeStatus = (statusId: string) => {
    const filtered = selectedStatuses.filter(s => s.status_id !== statusId);
    // Reorder remaining statuses
    const reordered = filtered.map((s, index) => ({
      ...s,
      display_order: index + 1
    }));
    onChange(reordered);
  };

  // Move status up in order
  const moveUp = (index: number) => {
    if (index === 0) return;

    const newStatuses = [...selectedStatuses];
    [newStatuses[index - 1], newStatuses[index]] = [newStatuses[index], newStatuses[index - 1]];

    // Update display_order to match new positions
    const reordered = newStatuses.map((s, idx) => ({
      ...s,
      display_order: idx + 1
    }));

    onChange(reordered);
  };

  // Move status down in order
  const moveDown = (index: number) => {
    if (index === selectedStatuses.length - 1) return;

    const newStatuses = [...selectedStatuses];
    [newStatuses[index], newStatuses[index + 1]] = [newStatuses[index + 1], newStatuses[index]];

    // Update display_order to match new positions
    const reordered = newStatuses.map((s, idx) => ({
      ...s,
      display_order: idx + 1
    }));

    onChange(reordered);
  };

  // Initialize with standard 3 statuses on first mount
  useEffect(() => {
    if (selectedStatuses.length === 0 && availableStatuses.length > 0) {
      // Try to find standard statuses: To Do, In Progress, Done
      const toDoStatus = availableStatuses.find(s => s.name.toLowerCase().includes('to do') || s.name.toLowerCase() === 'todo');
      const inProgressStatus = availableStatuses.find(s => s.name.toLowerCase().includes('in progress') || s.name.toLowerCase().includes('doing'));
      const doneStatus = availableStatuses.find(s => s.is_closed && (s.name.toLowerCase().includes('done') || s.name.toLowerCase().includes('complete')));

      const standardStatuses = [toDoStatus, inProgressStatus, doneStatus]
        .filter((s): s is IStatus => s !== undefined)
        .map((s, index) => ({
          status_id: s.status_id,
          display_order: index + 1
        }));

      if (standardStatuses.length === 3) {
        onChange(standardStatuses);
      } else if (availableStatuses.length >= 3) {
        // Fallback: use first 3 statuses if we can't find the standard ones
        onChange(availableStatuses.slice(0, 3).map((s, index) => ({
          status_id: s.status_id,
          display_order: index + 1
        })));
      }
    }
  }, [availableStatuses]);

  // Get unselected statuses
  const unselectedStatuses = availableStatuses.filter(
    status => !selectedStatuses.find(s => s.status_id === status.status_id)
  );

  // Toggle between standard and custom mode
  const handleExpandCustomize = () => {
    setIsExpanded(!isExpanded);
  };

  // Handle new status creation
  const handleStatusCreated = (newStatus: IStatus) => {
    // Notify parent to refresh statuses list
    onStatusCreated?.(newStatus);
    // Auto-add the new status to selection
    addStatus(newStatus.status_id);
  };

  return (
    <div className="space-y-2">
      <div className="flex justify-between items-center">
        <label className="block text-sm font-medium text-gray-700">
          Task Statuses *
        </label>
        {!isExpanded && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleExpandCustomize}
            id="customize-statuses-button"
          >
            <ChevronRight className="w-4 h-4 mr-1" />
            Customize
          </Button>
        )}
      </div>

      {/* Collapsed view - show summary only */}
      {!isExpanded && selectedStatuses.length > 0 && (
        <div className="text-sm text-gray-600 p-3 bg-gray-50 rounded-lg border">
          <div className="flex items-center gap-2 flex-wrap">
            {selectedStatuses.map((selected, index) => {
              const status = getStatusDetails(selected.status_id);
              if (!status) return null;
              return (
                <span key={selected.status_id} className="flex items-center">
                  {status.color && (
                    <Circle
                      className="w-3 h-3 mr-1"
                      fill={status.color}
                      stroke={status.color}
                    />
                  )}
                  {status.name}
                  {index < selectedStatuses.length - 1 && (
                    <ChevronRight className="w-3 h-3 mx-1 text-gray-400" />
                  )}
                </span>
              );
            })}
          </div>
        </div>
      )}

      {/* Expanded view - full customization */}
      {isExpanded && (
        <>
          <div className="flex justify-between items-center mb-2">
            <span className="text-xs text-gray-600">Customize task statuses for this project</span>
            <div className="flex gap-2">
              {unselectedStatuses.length > 0 && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowAvailableList(!showAvailableList)}
                  id="toggle-available-statuses"
                >
                  <Plus className="w-4 h-4 mr-1" />
                  Add Existing
                </Button>
              )}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setShowQuickAddStatus(true)}
                id="create-new-status-button"
              >
                <Plus className="w-4 h-4 mr-1" />
                Create New
              </Button>
            </div>
          </div>

          {/* Available statuses dropdown */}
          {showAvailableList && unselectedStatuses.length > 0 && (
            <div className="border rounded-lg p-3 bg-gray-50 space-y-2">
              <div className="text-xs font-medium text-gray-600 mb-2">
                Available Statuses (click to add):
              </div>
              {unselectedStatuses.map((status) => (
                <button
                  key={status.status_id}
                  type="button"
                  onClick={() => {
                    addStatus(status.status_id);
                    if (unselectedStatuses.length === 1) {
                      setShowAvailableList(false);
                    }
                  }}
                  className="w-full text-left px-3 py-2 text-sm bg-white border rounded hover:bg-blue-50 hover:border-blue-300 transition-colors flex items-center"
                  id={`add-status-${status.status_id}`}
                >
                  {status.color && (
                    <Circle
                      className="w-4 h-4 mr-2"
                      fill={status.color}
                      stroke={status.color}
                    />
                  )}
                  {status.name}
                  {status.is_closed && (
                    <span className="ml-2 text-xs px-2 py-0.5 bg-gray-200 rounded">
                      Closed
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}

          {/* Selected statuses list */}
          {selectedStatuses.length > 0 ? (
            <div className="border rounded-lg divide-y">
              {selectedStatuses.map((selected, index) => {
                const status = getStatusDetails(selected.status_id);
                if (!status) return null;

                return (
                  <div
                    key={selected.status_id}
                    className="flex items-center gap-2 p-3 bg-white hover:bg-gray-50"
                  >
                    {/* Reorder buttons */}
                    <div className="flex flex-col gap-0.5">
                      <button
                        type="button"
                        onClick={() => moveUp(index)}
                        disabled={index === 0}
                        className="p-0.5 hover:bg-gray-200 rounded disabled:opacity-30 disabled:cursor-not-allowed"
                        title="Move up"
                        id={`move-up-${status.status_id}`}
                      >
                        <ChevronUp className="w-3 h-3" />
                      </button>
                      <button
                        type="button"
                        onClick={() => moveDown(index)}
                        disabled={index === selectedStatuses.length - 1}
                        className="p-0.5 hover:bg-gray-200 rounded disabled:opacity-30 disabled:cursor-not-allowed"
                        title="Move down"
                        id={`move-down-${status.status_id}`}
                      >
                        <ChevronDown className="w-3 h-3" />
                      </button>
                    </div>

                    {/* Status color indicator */}
                    {status.color && (
                      <Circle
                        className="w-4 h-4"
                        fill={status.color}
                        stroke={status.color}
                      />
                    )}

                    {/* Status info */}
                    <div className="flex-1 text-sm">
                      <span className="font-medium">{status.name}</span>
                      {status.is_closed && (
                        <span className="ml-2 text-xs px-2 py-0.5 bg-gray-200 rounded">
                          Closed
                        </span>
                      )}
                    </div>

                    {/* Order number */}
                    <div className="text-xs text-gray-500 w-8 text-center">
                      #{index + 1}
                    </div>

                    {/* Remove button */}
                    <button
                      type="button"
                      onClick={() => removeStatus(selected.status_id)}
                      className="p-1 hover:bg-red-100 rounded text-red-600"
                      title="Remove status"
                      id={`remove-status-${status.status_id}`}
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="text-sm text-gray-500 p-4 bg-gray-50 rounded-lg border-2 border-dashed">
              <p className="font-medium mb-1">No statuses selected</p>
              <p className="text-xs">Click "Add Existing" to select from available statuses, or "Create New" to add a new status.</p>
            </div>
          )}

          <p className="text-xs text-gray-500 mt-2">
            Arrange statuses in the order tasks will flow through them.
          </p>
        </>
      )}

      {/* Error message */}
      {error && (
        <p className="text-xs text-red-500 mt-1">{error}</p>
      )}

      {/* Quick Add Status Dialog */}
      <QuickAddStatus
        open={showQuickAddStatus}
        onOpenChange={setShowQuickAddStatus}
        onStatusCreated={handleStatusCreated}
        statusType="project_task"
        existingStatuses={availableStatuses}
      />
    </div>
  );
}
