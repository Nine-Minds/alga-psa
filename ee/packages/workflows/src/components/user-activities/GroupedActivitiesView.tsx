'use client';

import React, { useState, useMemo, useCallback, useEffect } from 'react';
import {
  DndContext,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
  PointerSensor,
  useSensor,
  useSensors,
  CollisionDetection,
  pointerWithin,
  rectIntersection,
  useDroppable,
} from '@dnd-kit/core';
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Activity, ActivityType } from '@alga-psa/types';
import { useUserPreference } from '@alga-psa/user-composition/hooks';
import { Button } from '@alga-psa/ui/components/Button';
import { Badge } from '@alga-psa/ui/components/Badge';
import { Input } from '@alga-psa/ui/components/Input';
import {
  Plus,
  Trash2,
  ChevronDown,
  ChevronRight,
  GripVertical,
  Calendar,
  Layers,
  MessageSquare,
  ListChecks,
  Pencil,
  Check,
  X,
} from 'lucide-react';
import {
  createActivityGroup,
  updateActivityGroup,
  deleteActivityGroup,
  moveActivityToGroup,
  removeActivityFromGroups,
  reorderActivitiesInGroup,
  type ActivityGroup,
} from '@alga-psa/workflows/actions';
import { InlineStatusPicker } from './InlineStatusPicker';
import { InlinePriorityPicker } from './InlinePriorityPicker';
import { ActivityActionMenu } from './ActivityActionMenu';
import { useActivityDrawer } from './ActivityDrawerProvider';
import { cn } from '@alga-psa/ui/lib/utils';

const UNGROUPED_ID = '__ungrouped__';

/**
 * Wraps a SortableContext container with a droppable area so that activities
 * can be dropped into the container itself (not just onto existing items).
 * This is essential for moving activities into empty groups.
 */
function DroppableContainer({
  id,
  children,
  className,
}: {
  id: string;
  children: React.ReactNode;
  className?: string;
}) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div
      ref={setNodeRef}
      className={cn(className, isOver && 'rounded')}
      style={isOver ? { outline: '2px solid rgb(var(--color-primary-500))', outlineOffset: '-2px', backgroundColor: 'rgb(var(--color-primary-50) / 0.3)' } : undefined}
    >
      {children}
    </div>
  );
}

export function getActivityTypeLabel(type: ActivityType): string {
  switch (type) {
    case ActivityType.SCHEDULE:
      return 'Schedule';
    case ActivityType.PROJECT_TASK:
      return 'Project Task';
    case ActivityType.TICKET:
      return 'Ticket';
    case ActivityType.WORKFLOW_TASK:
      return 'Workflow Task';
    case ActivityType.TIME_ENTRY:
      return 'Time Entry';
    case ActivityType.NOTIFICATION:
      return 'Notification';
    default:
      return 'Activity';
  }
}

function getTypeIcon(type: ActivityType) {
  switch (type) {
    case ActivityType.SCHEDULE:
      return <Calendar className="h-4 w-4 text-success" />;
    case ActivityType.PROJECT_TASK:
      return <Layers className="h-4 w-4" style={{ color: 'rgb(var(--color-secondary-500))' }} />;
    case ActivityType.TICKET:
      return <MessageSquare className="h-4 w-4 text-primary-500" />;
    case ActivityType.WORKFLOW_TASK:
      return <ListChecks className="h-4 w-4 text-destructive" />;
    default:
      return null;
  }
}

interface GroupedActivitiesViewProps {
  activities: Activity[];
  serverGroups: ActivityGroup[];
  onGroupsChange: () => Promise<void> | void;
  onActionComplete?: () => void;
}

interface LocalGroup {
  groupId: string;
  groupName: string;
  sortOrder: number;
  isCollapsed: boolean;
  /** Ordered list of activities currently assigned to this group */
  activities: Activity[];
}

/**
 * Build the initial in-memory state by matching server groups to current activities.
 * Activities not in any group become "ungrouped".
 */
function buildLocalGroups(
  activities: Activity[],
  serverGroups: ActivityGroup[]
): { groups: LocalGroup[]; ungrouped: Activity[] } {
  const activityByKey = new Map<string, Activity>();
  for (const a of activities) {
    activityByKey.set(`${a.type}:${a.id}`, a);
  }

  const assignedKeys = new Set<string>();
  const groups: LocalGroup[] = serverGroups.map((sg) => {
    const groupActs: Activity[] = [];
    for (const item of sg.items) {
      const key = `${item.activityType}:${item.activityId}`;
      const act = activityByKey.get(key);
      if (act) {
        groupActs.push(act);
        assignedKeys.add(key);
      }
    }
    return {
      groupId: sg.groupId,
      groupName: sg.groupName,
      sortOrder: sg.sortOrder,
      isCollapsed: sg.isCollapsed,
      activities: groupActs,
    };
  });

  const ungrouped = activities.filter((a) => !assignedKeys.has(`${a.type}:${a.id}`));

  return { groups, ungrouped };
}

// ---------------------------------------------------------------------------
// Sortable activity row
// ---------------------------------------------------------------------------

interface SortableActivityRowProps {
  activity: Activity;
  onActionComplete?: () => void;
  onOpenDrawer: (activity: Activity) => void;
}

function SortableActivityRow({ activity, onActionComplete, onOpenDrawer }: SortableActivityRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: `${activity.type}:${activity.id}`,
    data: { activity, type: 'activity' },
  });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : undefined,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        'flex items-center gap-3 px-3 py-2 border-b border-border/50 bg-background',
        'hover:bg-muted/30 transition-colors group'
      )}
    >
      {/* Drag handle */}
      <button
        type="button"
        className="cursor-grab active:cursor-grabbing flex-shrink-0 w-5 p-0.5 text-muted-foreground hover:text-foreground opacity-40 group-hover:opacity-100 transition-opacity"
        {...attributes}
        {...listeners}
        aria-label="Drag to reorder"
      >
        <GripVertical className="h-4 w-4" />
      </button>

      {/* Type column: icon only with tooltip */}
      <div
        className="flex-shrink-0 w-6 flex items-center justify-center"
        title={getActivityTypeLabel(activity.type)}
      >
        {getTypeIcon(activity.type)}
      </div>

      {/* Title (clickable to open drawer) */}
      <button
        type="button"
        className="flex-1 min-w-0 text-left text-sm font-medium truncate hover:text-primary-600 transition-colors"
        onClick={() => onOpenDrawer(activity)}
      >
        {activity.title}
      </button>

      {/* Status picker */}
      <div className="flex-shrink-0 w-44">
        <InlineStatusPicker activity={activity} onStatusChange={onActionComplete} />
      </div>

      {/* Priority picker */}
      <div className="flex-shrink-0 w-40">
        <InlinePriorityPicker activity={activity} onPriorityChange={onActionComplete} />
      </div>

      {/* Due date */}
      <div className="flex-shrink-0 w-28 text-xs text-muted-foreground">
        {activity.dueDate
          ? new Date(activity.dueDate).toLocaleDateString('en-US', {
              month: 'short',
              day: 'numeric',
            })
          : <span className="text-muted-foreground/60">—</span>}
      </div>

      {/* Action menu */}
      <div className="flex-shrink-0 w-8 flex justify-end">
        <ActivityActionMenu
          activity={activity}
          onActionComplete={onActionComplete}
          onViewDetails={onOpenDrawer}
        />
      </div>
    </div>
  );
}

type GroupSortBy = 'title' | 'status' | 'priority' | 'dueDate' | 'type';

/**
 * Column header row with clickable sort headers.
 */
function GroupedViewColumnHeader({
  sortBy,
  sortDirection,
  onSortChange,
}: {
  sortBy?: GroupSortBy;
  sortDirection: 'asc' | 'desc';
  onSortChange: (column: GroupSortBy) => void;
}) {
  const renderHeader = (column: GroupSortBy, label: string, className: string) => {
    const isActive = sortBy === column;
    return (
      <button
        type="button"
        className={cn(
          className,
          'cursor-pointer hover:text-foreground transition-colors select-none',
          'flex items-center gap-1',
          isActive && 'text-foreground'
        )}
        onClick={() => onSortChange(column)}
      >
        {label}
        {isActive && (
          <span className="text-[10px]">{sortDirection === 'asc' ? '↑' : '↓'}</span>
        )}
      </button>
    );
  };

  return (
    <div className="flex items-center gap-3 px-3 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wide border-b border-border bg-muted/20 rounded-t-md">
      <div className="flex-shrink-0 w-5" aria-hidden="true" />
      <div className="flex-shrink-0 w-6" aria-hidden="true" />
      {renderHeader('title', 'Title', 'flex-1 min-w-0')}
      {renderHeader('status', 'Status', 'flex-shrink-0 w-44')}
      {renderHeader('priority', 'Priority', 'flex-shrink-0 w-40')}
      {renderHeader('dueDate', 'Due Date', 'flex-shrink-0 w-28')}
      <div className="flex-shrink-0 w-8" aria-hidden="true" />
    </div>
  );
}

/**
 * Sort activities in place within a group by the selected column.
 * None/empty values go to the bottom regardless of direction.
 */
function sortGroupActivities(
  activities: Activity[],
  sortBy?: GroupSortBy,
  sortDirection: 'asc' | 'desc' = 'asc'
): Activity[] {
  if (!sortBy) return activities;

  const sorted = [...activities];
  const dir = sortDirection === 'desc' ? -1 : 1;
  const cmp = (a: string, b: string) =>
    a.localeCompare(b, undefined, { sensitivity: 'base' });

  sorted.sort((a, b) => {
    switch (sortBy) {
      case 'type':
        return cmp(a.type, b.type) * dir;
      case 'title':
        return cmp(a.title || '', b.title || '') * dir;
      case 'status':
        return cmp(a.status || '', b.status || '') * dir;
      case 'priority': {
        const aNone = !a.priorityName;
        const bNone = !b.priorityName;
        if (aNone && bNone) return 0;
        if (aNone) return 1;
        if (bNone) return -1;
        return cmp(a.priorityName!, b.priorityName!) * dir;
      }
      case 'dueDate': {
        const aHas = !!a.dueDate;
        const bHas = !!b.dueDate;
        if (!aHas && !bHas) return 0;
        if (!aHas) return 1;
        if (!bHas) return -1;
        return (new Date(a.dueDate!).getTime() - new Date(b.dueDate!).getTime()) * dir;
      }
      default:
        return 0;
    }
  });
  return sorted;
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function GroupedActivitiesView({
  activities,
  serverGroups,
  onGroupsChange,
  onActionComplete,
}: GroupedActivitiesViewProps) {
  const { openActivityDrawer } = useActivityDrawer();

  const [localGroups, setLocalGroups] = useState<LocalGroup[]>([]);
  const [ungrouped, setUngrouped] = useState<Activity[]>([]);
  const [activeDragId, setActiveDragId] = useState<string | null>(null);
  const [groupSortBy, setGroupSortBy] = useState<GroupSortBy | undefined>(undefined);
  const [groupSortDirection, setGroupSortDirection] = useState<'asc' | 'desc'>('asc');

  const handleGroupSortChange = useCallback((column: GroupSortBy) => {
    if (groupSortBy === column) {
      setGroupSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setGroupSortBy(column);
      setGroupSortDirection('asc');
    }
  }, [groupSortBy]);
  const [newGroupName, setNewGroupName] = useState('');
  const [showNewGroupInput, setShowNewGroupInput] = useState(false);
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [editedGroupName, setEditedGroupName] = useState('');

  // Recompute local state whenever activities or server groups change
  useEffect(() => {
    const { groups, ungrouped: ung } = buildLocalGroups(activities, serverGroups);
    setLocalGroups(groups);
    setUngrouped(ung);
  }, [activities, serverGroups]);

  const handleOpenDrawer = useCallback((activity: Activity) => {
    openActivityDrawer(activity);
  }, [openActivityDrawer]);

  // -------- Group management -----------------------------------------------

  const handleCreateGroup = useCallback(async () => {
    const name = newGroupName.trim();
    if (!name) return;
    try {
      await createActivityGroup(name);
      setNewGroupName('');
      setShowNewGroupInput(false);
      await onGroupsChange();
    } catch (err) {
      console.error('Error creating group:', err);
    }
  }, [newGroupName, onGroupsChange]);

  const handleDeleteGroup = useCallback(async (groupId: string) => {
    try {
      await deleteActivityGroup(groupId);
      await onGroupsChange();
    } catch (err) {
      console.error('Error deleting group:', err);
    }
  }, [onGroupsChange]);

  const handleToggleCollapse = useCallback(async (group: LocalGroup) => {
    // Optimistic update
    setLocalGroups((prev) =>
      prev.map((g) => (g.groupId === group.groupId ? { ...g, isCollapsed: !g.isCollapsed } : g))
    );
    try {
      await updateActivityGroup(group.groupId, { isCollapsed: !group.isCollapsed });
    } catch (err) {
      console.error('Error updating group:', err);
      await onGroupsChange();
    }
  }, [onGroupsChange]);

  const handleStartRename = (group: LocalGroup) => {
    setEditingGroupId(group.groupId);
    setEditedGroupName(group.groupName);
  };

  const handleSaveRename = useCallback(async () => {
    if (!editingGroupId || !editedGroupName.trim()) {
      setEditingGroupId(null);
      return;
    }
    try {
      await updateActivityGroup(editingGroupId, { groupName: editedGroupName.trim() });
      setEditingGroupId(null);
      await onGroupsChange();
    } catch (err) {
      console.error('Error renaming group:', err);
    }
  }, [editingGroupId, editedGroupName, onGroupsChange]);

  // -------- Drag and drop --------------------------------------------------

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 },
    })
  );

  const handleDragStart = (event: DragStartEvent) => {
    setActiveDragId(event.active.id as string);
  };

  const findContainer = useCallback((itemKey: string): string | null => {
    // Returns the container id that holds this item (group id or UNGROUPED_ID)
    for (const group of localGroups) {
      if (group.activities.some((a) => `${a.type}:${a.id}` === itemKey)) {
        return group.groupId;
      }
    }
    if (ungrouped.some((a) => `${a.type}:${a.id}` === itemKey)) {
      return UNGROUPED_ID;
    }
    return null;
  }, [localGroups, ungrouped]);

  const handleDragEnd = useCallback(async (event: DragEndEvent) => {
    setActiveDragId(null);

    const { active, over } = event;
    if (!over) return;

    const activeKey = active.id as string;
    const overId = over.id as string;

    const sourceContainer = findContainer(activeKey);
    if (!sourceContainer) return;

    // Determine the target container: either a container id (group/ungrouped) or an item id
    const targetContainer =
      overId === UNGROUPED_ID || localGroups.some((g) => g.groupId === overId)
        ? overId
        : findContainer(overId);

    if (!targetContainer) return;

    // Find the activity being moved
    const parseKey = (k: string) => {
      const idx = k.indexOf(':');
      return { type: k.slice(0, idx), id: k.slice(idx + 1) };
    };
    const activeParsed = parseKey(activeKey);

    // Find the over index (if dropping over an item within the target container)
    const getContainerActivities = (containerId: string): Activity[] => {
      if (containerId === UNGROUPED_ID) return ungrouped;
      return localGroups.find((g) => g.groupId === containerId)?.activities || [];
    };

    const targetActivities = getContainerActivities(targetContainer);
    const overIndex = overId === targetContainer
      ? targetActivities.length // dropped on the container itself → append
      : targetActivities.findIndex((a) => `${a.type}:${a.id}` === overId);

    // -------- Same-container reorder ------------------------------------
    if (sourceContainer === targetContainer) {
      const currentIdx = targetActivities.findIndex((a) => `${a.type}:${a.id}` === activeKey);
      if (currentIdx === -1 || overIndex === -1 || currentIdx === overIndex) return;

      const reordered = arrayMove(targetActivities, currentIdx, overIndex);

      // Optimistic update
      if (sourceContainer === UNGROUPED_ID) {
        setUngrouped(reordered);
      } else {
        setLocalGroups((prev) =>
          prev.map((g) =>
            g.groupId === sourceContainer ? { ...g, activities: reordered } : g
          )
        );
        // Persist new sort orders
        try {
          await reorderActivitiesInGroup(
            sourceContainer,
            reordered.map((a, idx) => ({
              activityId: a.id,
              activityType: a.type,
              sortOrder: idx,
            }))
          );
        } catch (err) {
          console.error('Error reordering in group:', err);
          await onGroupsChange();
        }
      }
      return;
    }

    // -------- Cross-container move --------------------------------------
    if (targetContainer === UNGROUPED_ID) {
      // Moving from a group to ungrouped → remove from group
      try {
        await removeActivityFromGroups(activeParsed.id, activeParsed.type);
        await onGroupsChange();
      } catch (err) {
        console.error('Error removing from group:', err);
      }
    } else {
      // Moving to a group (from ungrouped or another group)
      const insertAt = overIndex === -1 ? targetActivities.length : overIndex;
      try {
        await moveActivityToGroup(
          activeParsed.id,
          activeParsed.type,
          targetContainer,
          insertAt
        );
        await onGroupsChange();
      } catch (err) {
        console.error('Error moving to group:', err);
      }
    }
  }, [findContainer, localGroups, ungrouped, onGroupsChange]);

  // Custom collision detection: prefer pointer-within for groups, fall back to rect
  const collisionDetection: CollisionDetection = useCallback(
    (args) => {
      const pointerCollisions = pointerWithin(args);
      if (pointerCollisions.length > 0) return pointerCollisions;
      return rectIntersection(args);
    },
    []
  );

  // Find the activity for the drag overlay
  const activeActivity = useMemo(() => {
    if (!activeDragId) return null;
    const parseKey = (k: string) => {
      const idx = k.indexOf(':');
      return { type: k.slice(0, idx), id: k.slice(idx + 1) };
    };
    const { id } = parseKey(activeDragId);
    return activities.find((a) => a.id === id) || null;
  }, [activeDragId, activities]);


  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collisionDetection}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div className="space-y-4">
        {/* Toolbar */}
        <div className="flex items-center gap-2">
          {showNewGroupInput ? (
            <div className="flex items-center gap-2">
              <Input
                id="new-group-name"
                value={newGroupName}
                onChange={(e) => setNewGroupName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleCreateGroup();
                  if (e.key === 'Escape') {
                    setShowNewGroupInput(false);
                    setNewGroupName('');
                  }
                }}
                placeholder="Group name"
                autoFocus
                className="max-w-[240px]"
              />
              <Button id="create-group" size="sm" onClick={handleCreateGroup}>
                <Check className="h-4 w-4" />
              </Button>
              <Button
                id="cancel-create-group"
                size="sm"
                variant="ghost"
                onClick={() => {
                  setShowNewGroupInput(false);
                  setNewGroupName('');
                }}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          ) : (
            <Button
              id="add-group"
              size="sm"
              variant="outline"
              onClick={() => setShowNewGroupInput(true)}
            >
              <Plus className="h-4 w-4 mr-1" />
              Add Group
            </Button>
          )}
        </div>

        {/* Column headers */}
        <GroupedViewColumnHeader
          sortBy={groupSortBy}
          sortDirection={groupSortDirection}
          onSortChange={handleGroupSortChange}
        />

        {/* Groups */}
        {localGroups.map((group) => {
          const sortedGroup = groupSortBy
            ? { ...group, activities: sortGroupActivities(group.activities, groupSortBy, groupSortDirection) }
            : group;
          return (
            <GroupSection
              key={group.groupId}
              group={sortedGroup}
              editingGroupId={editingGroupId}
              editedGroupName={editedGroupName}
              onStartRename={handleStartRename}
              onEditGroupName={setEditedGroupName}
              onSaveRename={handleSaveRename}
              onCancelRename={() => setEditingGroupId(null)}
              onToggleCollapse={handleToggleCollapse}
              onDeleteGroup={handleDeleteGroup}
              onOpenDrawer={handleOpenDrawer}
              onActionComplete={onActionComplete}
            />
          );
        })}

        {/* Ungrouped section */}
        <UngroupedSection
          activities={groupSortBy ? sortGroupActivities(ungrouped, groupSortBy, groupSortDirection) : ungrouped}
          onOpenDrawer={handleOpenDrawer}
          onActionComplete={onActionComplete}
        />
      </div>

      <DragOverlay>
        {activeActivity && (
          <div className="bg-background shadow-lg border border-border rounded-md px-3 py-2 flex items-center gap-2 max-w-md">
            {getTypeIcon(activeActivity.type)}
            <span className="text-sm font-medium truncate">{activeActivity.title}</span>
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}

// ---------------------------------------------------------------------------
// Group section component
// ---------------------------------------------------------------------------

interface GroupSectionProps {
  group: LocalGroup;
  editingGroupId: string | null;
  editedGroupName: string;
  onStartRename: (group: LocalGroup) => void;
  onEditGroupName: (name: string) => void;
  onSaveRename: () => void;
  onCancelRename: () => void;
  onToggleCollapse: (group: LocalGroup) => void;
  onDeleteGroup: (groupId: string) => void;
  onOpenDrawer: (activity: Activity) => void;
  onActionComplete?: () => void;
}

function GroupSection({
  group,
  editingGroupId,
  editedGroupName,
  onStartRename,
  onEditGroupName,
  onSaveRename,
  onCancelRename,
  onToggleCollapse,
  onDeleteGroup,
  onOpenDrawer,
  onActionComplete,
}: GroupSectionProps) {
  const itemIds = useMemo(
    () => group.activities.map((a) => `${a.type}:${a.id}`),
    [group.activities]
  );

  const isEditing = editingGroupId === group.groupId;

  return (
    <div className="border border-border rounded-md bg-card">
      {/* Group header */}
      <div className="flex items-center gap-2 px-3 py-2 bg-muted/30 border-b border-border">
        <button
          type="button"
          onClick={() => onToggleCollapse(group)}
          className="text-muted-foreground hover:text-foreground"
          aria-label={group.isCollapsed ? 'Expand group' : 'Collapse group'}
        >
          {group.isCollapsed ? (
            <ChevronRight className="h-4 w-4" />
          ) : (
            <ChevronDown className="h-4 w-4" />
          )}
        </button>

        {isEditing ? (
          <div className="flex-1 flex items-center gap-2">
            <Input
              id={`rename-${group.groupId}`}
              value={editedGroupName}
              onChange={(e) => onEditGroupName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') onSaveRename();
                if (e.key === 'Escape') onCancelRename();
              }}
              autoFocus
              className="max-w-[240px] h-7"
            />
            <Button id={`save-rename-${group.groupId}`} size="sm" onClick={onSaveRename}>
              <Check className="h-3.5 w-3.5" />
            </Button>
            <Button
              id={`cancel-rename-${group.groupId}`}
              size="sm"
              variant="ghost"
              onClick={onCancelRename}
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        ) : (
          <>
            <h3 className="flex-1 text-sm font-semibold truncate">{group.groupName}</h3>
            <Badge variant="default" className="text-xs">
              {group.activities.length}
            </Badge>
            <Button
              id={`rename-group-${group.groupId}`}
              size="sm"
              variant="ghost"
              className="h-7 w-7 p-0"
              onClick={() => onStartRename(group)}
              aria-label="Rename group"
            >
              <Pencil className="h-3.5 w-3.5" />
            </Button>
            <Button
              id={`delete-group-${group.groupId}`}
              size="sm"
              variant="ghost"
              className="h-7 w-7 p-0 text-destructive hover:text-destructive"
              onClick={() => onDeleteGroup(group.groupId)}
              aria-label="Delete group"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </>
        )}
      </div>

      {/* Group items */}
      {!group.isCollapsed && (
        <SortableContext id={group.groupId} items={itemIds} strategy={verticalListSortingStrategy}>
          <DroppableContainer id={group.groupId} className="min-h-[48px]">
            {group.activities.length === 0 ? (
              <div className="py-6 px-3 text-center text-xs text-muted-foreground">
                Drop activities here
              </div>
            ) : (
              group.activities.map((activity) => (
                <SortableActivityRow
                  key={`${activity.type}:${activity.id}`}
                  activity={activity}
                  onOpenDrawer={onOpenDrawer}
                  onActionComplete={onActionComplete}
                />
              ))
            )}
          </DroppableContainer>
        </SortableContext>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Ungrouped section
// ---------------------------------------------------------------------------

interface UngroupedSectionProps {
  activities: Activity[];
  onOpenDrawer: (activity: Activity) => void;
  onActionComplete?: () => void;
}

function UngroupedSection({ activities, onOpenDrawer, onActionComplete }: UngroupedSectionProps) {
  const { value: collapsed, setValue: setCollapsed } = useUserPreference<boolean>(
    'activitiesUngroupedCollapsed',
    { defaultValue: false, localStorageKey: 'activitiesUngroupedCollapsed', debounceMs: 300 }
  );
  const itemIds = useMemo(
    () => activities.map((a) => `${a.type}:${a.id}`),
    [activities]
  );

  return (
    <div className="border border-dashed border-border rounded-md bg-background">
      <div
        className="flex items-center gap-2 px-3 py-2 bg-muted/10 border-b border-dashed border-border cursor-pointer"
        onClick={() => setCollapsed((prev) => !prev)}
      >
        {collapsed ? (
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        ) : (
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        )}
        <h3 className="text-sm font-semibold text-muted-foreground">
          Ungrouped{' '}
          <span className="text-xs font-normal">({activities.length})</span>
        </h3>
      </div>
      {!collapsed && (
      <SortableContext id={UNGROUPED_ID} items={itemIds} strategy={verticalListSortingStrategy}>
        <DroppableContainer id={UNGROUPED_ID} className="min-h-[48px]">
          {activities.length === 0 ? (
            <div className="py-4 px-3 text-center text-xs text-muted-foreground">
              All activities are in groups
            </div>
          ) : (
            activities.map((activity) => (
              <SortableActivityRow
                key={`${activity.type}:${activity.id}`}
                activity={activity}
                onOpenDrawer={onOpenDrawer}
                onActionComplete={onActionComplete}
              />
            ))
          )}
        </DroppableContainer>
      </SortableContext>
      )}
    </div>
  );
}
