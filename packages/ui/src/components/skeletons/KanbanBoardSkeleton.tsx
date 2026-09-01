const KanbanBoardSkeleton = () => {
  // Mock 3 status columns
  const mockStatuses = ['To Do', 'In Progress', 'Done'];

  return (
    <div className="flex gap-4 min-w-min flex-1 min-h-0 h-full overflow-x-auto overflow-y-hidden pb-2">
      {mockStatuses.map((status, index) => (
        <div key={status} className="flex flex-col w-[350px] min-w-[350px] max-w-[350px] flex-shrink-0 h-[calc(100vh-200px)] max-h-[calc(100vh-200px)] overflow-hidden">
          {/* Column Header */}
          <div className="bg-[rgb(var(--color-border-100))] rounded-t-lg p-3 animate-pulse">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 skeleton-fill-strong rounded"></div>
                <div className="h-5 skeleton-fill-strong rounded w-20"></div>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 skeleton-fill-strong rounded-full"></div>
                <div className="h-5 skeleton-fill-strong rounded w-8"></div>
              </div>
            </div>
          </div>

          {/* Column Body */}
          <div className="p-2 flex-1 overflow-y-auto overflow-x-hidden rounded-b-lg bg-[rgb(var(--color-border-50))] border-x border-b border-[rgb(var(--color-border-200))]">
            {/* Mock task cards */}
            {[1, 2, 3].map((cardIndex) => (
              <div key={cardIndex} className="mb-2 p-3 bg-[rgb(var(--color-card))] border border-[rgb(var(--color-border-200))] rounded-lg animate-pulse">
                {/* Task header with checkbox and menu */}
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-start gap-3 flex-1">
                    {/* Checkbox */}
                    <div className="w-4 h-4 skeleton-fill rounded mt-1"></div>
                    {/* Task title */}
                    <div className="flex-1">
                      <div className="h-5 skeleton-fill-strong rounded w-3/4"></div>
                    </div>
                  </div>
                  {/* Three dots menu */}
                  <div className="w-5 h-5 skeleton-fill rounded"></div>
                </div>

                {/* Assignee */}
                <div className="mb-3">
                  <div className="flex items-center gap-2 bg-[rgb(var(--color-border-50))] border border-[rgb(var(--color-border-200))] rounded-md px-3 py-2 w-fit">
                    <div className="w-6 h-6 skeleton-fill-strong rounded-full"></div>
                    <div className="h-4 skeleton-fill-strong rounded w-24"></div>
                    <div className="w-4 h-4 skeleton-fill rounded"></div>
                  </div>
                </div>

                {/* Due date and counters */}
                <div className="flex items-center justify-between mb-3">
                  <div className="h-4 skeleton-fill rounded w-24"></div>
                  <div className="flex items-center gap-2">
                    {/* Checklist counter */}
                    <div className="flex items-center gap-1">
                      <div className="w-4 h-4 skeleton-fill rounded"></div>
                      <div className="h-4 skeleton-fill rounded w-8"></div>
                    </div>
                    {/* Attachment counter */}
                    <div className="flex items-center gap-1">
                      <div className="w-4 h-4 skeleton-fill rounded"></div>
                      <div className="h-4 skeleton-fill rounded w-4"></div>
                    </div>
                  </div>
                </div>

                {/* Tags */}
                <div className="flex items-center gap-2">
                  <div className="h-6 skeleton-fill rounded-full px-3 w-16"></div>
                  <div className="h-6 skeleton-fill rounded-full px-3 w-20"></div>
                  <div className="w-6 h-6 skeleton-fill rounded flex items-center justify-center">
                    <div className="w-3 h-3 skeleton-fill-strong rounded"></div>
                  </div>
                </div>
              </div>
            ))}

          </div>
        </div>
      ))}
    </div>
  );
};

export default KanbanBoardSkeleton;
