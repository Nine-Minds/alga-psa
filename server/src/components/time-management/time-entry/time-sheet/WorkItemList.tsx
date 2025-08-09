'use client'
import { WorkItemWithStatus, WorkItemType } from 'server/src/interfaces/workItem.interfaces';

interface WorkItemListProps {
  items: WorkItemWithStatus[];
  isSearching: boolean;
  currentPage: number;
  totalPages: number;
  total: number;
  hasMore: boolean;
  onPageChange: (newPage: number) => void;
  onSelect: (workItem: WorkItemWithStatus) => void;
}

export function WorkItemList({
  items,
  isSearching,
  currentPage,
  totalPages,
  total,
  hasMore,
  onPageChange,
  onSelect
}: WorkItemListProps) {

  const renderItemContent = (item: WorkItemWithStatus) => {
    if (item.type === 'ticket') {
      return (
        <>
          <div className="font-medium text-[rgb(var(--color-text-900))] text-lg mb-1">
            {item.ticket_number} - {item.title || 'Untitled'}
          </div>
          <div className="text-sm text-[rgb(var(--color-text-600))] mt-1">
            {item.company_name}
          </div>
          <div className="text-sm text-[rgb(var(--color-text-600))] mt-1">
            Due Date: {item.due_date ? new Date(item.due_date).toLocaleDateString() : 'No due date'}
          </div>
          <div className="flex items-center gap-2 mt-1">
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-[rgb(var(--color-primary-200))] text-[rgb(var(--color-primary-900))]">
              Ticket
            </span>
            {item.is_billable && (
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-[rgb(var(--color-accent-100))] text-[rgb(var(--color-accent-800))]">
                Billable
              </span>
            )}
          </div>
        </>
      );
    } else if (item.type === 'project_task') {
      return (
        <>
          <div className="font-medium text-[rgb(var(--color-text-900))] text-lg mb-1">
            {item.task_name}
          </div>
          <div className="text-sm text-[rgb(var(--color-text-600))]">
            {item.project_name} • {item.phase_name}
          </div>
          <div className="text-sm text-[rgb(var(--color-text-600))] mt-1">
            {item.company_name}
          </div>
          <div className="text-sm text-[rgb(var(--color-text-600))] mt-1">
            Due Date: {item.due_date ? new Date(item.due_date).toLocaleDateString() : 'No due date'}
          </div>
          <div className="flex items-center gap-2 mt-1">
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-[rgb(var(--color-secondary-100))] text-[rgb(var(--color-secondary-900))]">
              Project Task
            </span>
            {item.is_billable && (
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-[rgb(var(--color-accent-100))] text-[rgb(var(--color-accent-800))]">
                Billable
              </span>
            )}
          </div>
        </>
      );
    } else if (item.type === 'ad_hoc') {
      return (
        <>
          <div className="font-medium text-[rgb(var(--color-text-900))] text-lg mb-1">
            {item.title || item.name}
          </div>
          {item.scheduled_start && item.scheduled_end && (
            <div className="text-sm text-[rgb(var(--color-text-600))]">
              Scheduled end: {new Date(item.scheduled_end).toLocaleString('en-US', {month: '2-digit', day: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'})}
            </div>
          )}
          <div className="flex items-center gap-2 mt-1">
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-[rgb(var(--color-border-200))] text-[rgb(var(--color-border-900))]">
              Ad-hoc Entry
            </span>
            {item.is_billable && (
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-[rgb(var(--color-accent-100))] text-[rgb(var(--color-accent-800))]">
                Billable
              </span>
            )}
          </div>
        </>
      );
    } else if (item.type === 'interaction') {
      return (
        <>
          <div className="font-medium text-[rgb(var(--color-text-900))] text-lg mb-1">
            {item.title || item.name}
          </div>
          <div className="text-sm text-[rgb(var(--color-text-600))]">
            {item.interaction_type && `${item.interaction_type} • `}{item.company_name}
          </div>
          {item.contact_name && (
            <div className="text-sm text-[rgb(var(--color-text-600))] mt-1">
              Contact: {item.contact_name}
            </div>
          )}
          <div className="flex items-center gap-2 mt-1">
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-900">
              Interaction
            </span>
            {item.is_billable && (
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-[rgb(var(--color-accent-100))] text-[rgb(var(--color-accent-800))]">
                Billable
              </span>
            )}
          </div>
        </>
      );
    }
    return null;
  };

  return (
    <div className="flex-1 min-h-[200px] overflow-auto transition-all duration-300">
      <div className="h-full overflow-y-auto">
        <div className="bg-white dark:bg-[rgb(var(--color-border-50))] rounded-md border border-[rgb(var(--color-border-200))]">
          {items.length > 0 ? (
            <div>
              <ul className="divide-y divide-[rgb(var(--color-border-200))]">
                {items.map((item) => (
                  <li
                    key={item.work_item_id}
                    className="bg-[rgb(var(--color-border-50))] hover:bg-[rgb(var(--color-border-100))] cursor-pointer transition-colors duration-150"
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelect(item);
                    }}
                  >
                    <div className="px-4 py-3">
                      {renderItemContent(item)}
                    </div>
                  </li>
                ))}
              </ul>
              <div className="px-6 py-4 border-t border-gray-100 bg-white">
                <div className="flex items-center justify-between">
                  <button
                    onClick={() => onPageChange(currentPage - 1)}
                    disabled={currentPage === 1 || isSearching}
                    className="px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-[rgb(var(--color-text-700))] bg-white hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    id="previous-page-btn"
                  >
                    Previous
                  </button>
                  <span className="text-sm text-[rgb(var(--color-text-700))]">
                    Page {currentPage} of {Math.max(1, totalPages)} ({total} total records)
                  </span>
                  <button
                    onClick={() => onPageChange(currentPage + 1)}
                    disabled={!hasMore || isSearching || currentPage >= totalPages}
                    className="px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-[rgb(var(--color-text-700))] bg-white hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    id="next-page-btn"
                  >
                    Next
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="p-4 text-center text-[rgb(var(--color-text-500))]">
              {isSearching ? 'Searching...' : 'No work items found'}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
