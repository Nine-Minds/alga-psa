import React from 'react';
import WorkItemCard from './WorkItemCard';
import { IExtendedWorkItem, IWorkItem } from '@alga-psa/types';
import { StatusOption } from '@alga-psa/reference-data/actions';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { Switch } from '@alga-psa/ui/components/Switch';
import { Input } from '@alga-psa/ui/components/Input';
import { Button } from '@alga-psa/ui/components/Button';

interface WorkItemListPanelProps {
  workItems: Omit<IExtendedWorkItem, "tenant">[];
  totalItems: number;
  currentPage: number;
  totalPages: number;
  searchQuery: string;
  selectedStatusFilter: string;
  filterUnscheduled: boolean;
  sortOrder: 'asc' | 'desc';
  statusFilterOptions: StatusOption[];
  onSearchChange: (query: string) => void;
  onStatusFilterChange: (value: string) => void;
  onUnscheduledFilterChange: (checked: boolean) => void;
  onSortChange: () => void;
  onPageChange: (page: number) => void;
  onWorkItemClick: (e: React.MouseEvent, item: Omit<IExtendedWorkItem, "tenant">) => void;
  onWorkItemDragStart?: (e: React.DragEvent, workItemId: string, item: Omit<IWorkItem, "tenant">) => void;
  onWorkItemDrag?: (e: React.DragEvent) => void;
  onWorkItemDragEnd?: () => void;
  canEdit?: boolean;
}

const WorkItemListPanel: React.FC<WorkItemListPanelProps> = ({
  workItems,
  totalItems,
  currentPage,
  totalPages,
  searchQuery,
  selectedStatusFilter,
  filterUnscheduled,
  sortOrder,
  statusFilterOptions,
  onSearchChange,
  onStatusFilterChange,
  onUnscheduledFilterChange,
  onSortChange,
  onPageChange,
  onWorkItemClick,
  onWorkItemDragStart,
  onWorkItemDrag,
  onWorkItemDragEnd,
}) => {
  return (
    <div className="w-1/4 p-2 bg-[rgb(var(--color-border-50))] overflow-y-auto">
      <h2 className="text-xl font-bold mb-4 text-[rgb(var(--color-text-900))]">Work Items</h2>

      <div className="space-y-3 mb-4">
        <div className="flex gap-2 justify-between">
          <Input
            id="work-item-search"
            type="text"
            placeholder="Search work items..."
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            className="flex-grow mb-0"
          />
          <Button
            id="sort-work-items"
            variant="outline"
            size="sm"
            onClick={onSortChange}
          >
            {sortOrder === 'asc' ? '↑' : '↓'}
          </Button>
        </div>

        <div className="flex gap-2 justify-between items-center">
          <CustomSelect
            value={selectedStatusFilter}
            onValueChange={onStatusFilterChange}
            options={statusFilterOptions}
            placeholder="Filter by status..."
          />

          <div className="flex items-center gap-2">
            <span className={`text-sm`}>
              {filterUnscheduled ? 'Unscheduled' : 'Scheduled'}
            </span>
            <Switch
              id="schedule-filter"
              checked={!filterUnscheduled}
              onCheckedChange={onUnscheduledFilterChange}
            />
          </div>
        </div>
      </div>

      <div className="space-y-2 mb-4">
        {workItems.map((item): React.JSX.Element => (
          <div
            key={item.work_item_id}
            className="p-2 border border-[rgb(var(--color-border-200))] rounded bg-white cursor-move hover:bg-[rgb(var(--color-border-50))] transition-colors"
            draggable={!!onWorkItemDragStart}
            onDragStart={(e) => onWorkItemDragStart?.(e, item.work_item_id, item)}
            onDrag={onWorkItemDrag}
            onDragEnd={onWorkItemDragEnd}
          >
            <WorkItemCard
              title={item.name}
              description={item.description}
              type={item.type}
              // isBillable={item.is_billable}
              needsDispatch={item.needsDispatch}
              agentsNeedingDispatch={item.agentsNeedingDispatch}
              onClick={(e) => onWorkItemClick(e, item)}
            />
          </div>
        ))}
      </div>

      {totalPages > 1 && (
        <div className="flex justify-center items-center gap-2">
          <button
            onClick={() => onPageChange(Math.max(1, currentPage - 1))}
            disabled={currentPage === 1}
            className="p-2 border border-[rgb(var(--color-border-200))] rounded bg-white text-[rgb(var(--color-text-900))] hover:bg-[rgb(var(--color-border-100))] transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:border-[rgb(var(--color-primary-400))] focus:ring-1 focus:ring-[rgb(var(--color-primary-400))]"
          >
            Previous
          </button>
          <span className="text-[rgb(var(--color-text-700))]">
            Page {currentPage} of {totalPages}
          </span>
          <button
            onClick={() => onPageChange(Math.min(totalPages, currentPage + 1))}
            disabled={currentPage === totalPages}
            className="p-2 border border-[rgb(var(--color-border-200))] rounded bg-white text-[rgb(var(--color-text-900))] hover:bg-[rgb(var(--color-border-100))] transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:border-[rgb(var(--color-primary-400))] focus:ring-1 focus:ring-[rgb(var(--color-primary-400))]"
          >
            Next
          </button>
        </div>
      )}

      <div className="text-sm text-[rgb(var(--color-text-600))] mt-2 text-center">
        Showing {workItems.length} of {totalItems} items
      </div>
    </div>
  );
};

export default WorkItemListPanel;