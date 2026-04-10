'use client';

import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useTruncationDetection } from '@alga-psa/ui/hooks';
import { useRouter } from 'next/navigation';
import { useTheme } from 'next-themes';
import { darkenColor } from '@alga-psa/ui/lib/colorUtils';
import { Button } from '@alga-psa/ui/components/Button';
import { CollapseToggleButton } from '@alga-psa/ui/components/CollapseToggleButton';
import { Dialog } from '@alga-psa/ui/components/Dialog';
import { ConfirmationDialog } from '@alga-psa/ui/components/ConfirmationDialog';
import { Badge } from '@alga-psa/ui/components/Badge';
import { Input } from '@alga-psa/ui/components/Input';
import { TextArea } from '@alga-psa/ui/components/TextArea';
import {
  ArrowLeft,
  Clipboard,
  Trash,
  FileText,
  Rocket,
  Plus,
  Pencil,
  GripVertical,
  Settings,
  CheckSquare,
  Bug,
  Sparkles,
  TrendingUp,
  Flag,
  BookOpen,
  Users,
  MoreVertical,
  Clock,
  Ban,
  GitBranch,
  Search,
  Pin,
  X,
  Columns3,
} from 'lucide-react';
import { Tooltip } from '@alga-psa/ui/components/Tooltip';
import {
  IProjectTemplateWithDetails,
  IProjectTemplateTask,
  IProjectTemplatePhase,
  IProjectTemplateStatusMapping,
  IProjectTemplateTaskAssignment,
  IProjectTemplateChecklistItem,
  IProjectTemplateDependency,
} from '@alga-psa/types';
import {
  deleteTemplate,
  updateTemplate,
  addTemplatePhase,
  updateTemplatePhase,
  deleteTemplatePhase,
  reorderTemplatePhase,
  addTemplateTask,
  updateTemplateTask,
  deleteTemplateTask,
  updateTemplateTaskStatus,
  setTaskAdditionalAgents,
  saveTemplateChecklistItems,
  addTemplateDependency,
  removeTemplateDependency,
} from '../../actions/projectTemplateActions';
import { DependencyType, IClientPortalConfig, DEFAULT_CLIENT_PORTAL_CONFIG } from '@alga-psa/types';
import ClientPortalConfigEditor from '../ClientPortalConfigEditor';
import { getTenantProjectStatuses } from '../../actions/projectTaskStatusActions';
import { getTaskTypes } from '../../actions/projectTaskActions';
import { getAllPriorities } from '@alga-psa/reference-data/actions';
import { getAllUsers } from '@alga-psa/user-composition/actions';
import { ITaskType } from '@alga-psa/types';
import { IUserWithRoles } from '@alga-psa/types';
import { toast } from 'react-hot-toast';
import { handleError } from '@alga-psa/ui/lib/errorHandling';
import { ApplyTemplateDialog } from './ApplyTemplateDialog';
import { TemplateTaskForm } from './TemplateTaskForm';
import { TemplateStatusManager } from './TemplateStatusManager';
import {
  getEffectiveTemplateStatusMappings,
  hasTemplatePhaseStatusMappings,
} from '../../lib/templateStatusMappingUtils';
import TemplateTaskListView from './TemplateTaskListView';
import ViewSwitcher from '@alga-psa/ui/components/ViewSwitcher';
import KanbanZoomControl, { calculateCardGap, calculateColumnWidth, calculateZoomScales } from '../KanbanZoomControl';
import * as LucideIcons from 'lucide-react';
import { LayoutGrid, List } from 'lucide-react';
import { useKanbanPan } from '../useKanbanPan';
import styles from '../ProjectDetail.module.css';
import UserPicker from '@alga-psa/ui/components/UserPicker';
import UserAvatar from '@alga-psa/ui/components/UserAvatar';
import TeamAvatar from '@alga-psa/ui/components/TeamAvatar';
import { useFeatureFlag } from '@alga-psa/ui/hooks';
import { getTeams, getTeamAvatarUrlsBatchAction } from '@alga-psa/teams/actions';
import type { ITeam } from '@alga-psa/types';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@alga-psa/ui/components/DropdownMenu';
import { getUserAvatarUrlsBatchAction } from '@alga-psa/user-composition/actions';
import { useTranslation } from 'react-i18next';

// Task type icons mapping (fallback icons when database doesn't specify)
// Helper to lighten hex color (for background)
const lightenColor = (hex: string, percent: number) => {
  const num = parseInt(hex.replace('#', ''), 16);
  const r = Math.min(255, Math.floor((num >> 16) + (255 - (num >> 16)) * percent));
  const g = Math.min(255, Math.floor(((num >> 8) & 0x00ff) + (255 - ((num >> 8) & 0x00ff)) * percent));
  const b = Math.min(255, Math.floor((num & 0x0000ff) + (255 - (num & 0x0000ff)) * percent));
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
};

const taskTypeIcons: Record<string, React.ComponentType<{ className?: string; style?: React.CSSProperties }>> = {
  task: CheckSquare,
  bug: Bug,
  feature: Sparkles,
  improvement: TrendingUp,
  epic: Flag,
  story: BookOpen,
  milestone: Flag,
  deliverable: FileText,
};

const getTemplateStatusIcon = (statusMapping: IProjectTemplateStatusMapping): React.ReactNode => {
  if (statusMapping.icon) {
    const IconComponent = (LucideIcons as any)[statusMapping.icon];
    if (IconComponent) {
      return <IconComponent className="w-4 h-4" />;
    }
  }

  return <Clipboard className="w-4 h-4" />;
};

interface TemplateEditorProps {
  template: IProjectTemplateWithDetails;
  onTemplateUpdated: () => void;
}

export default function TemplateEditor({ template: initialTemplate, onTemplateUpdated }: TemplateEditorProps) {
  const { t } = useTranslation(['features/projects', 'common']);
  const router = useRouter();
  const { resolvedTheme } = useTheme();

  // Core state
  const [template, setTemplate] = useState<IProjectTemplateWithDetails>(initialTemplate);
  const [phases, setPhases] = useState<IProjectTemplatePhase[]>(initialTemplate.phases || []);
  const [tasks, setTasks] = useState<IProjectTemplateTask[]>(initialTemplate.tasks || []);
  const [statusMappings, setStatusMappings] = useState<IProjectTemplateStatusMapping[]>(
    initialTemplate.status_mappings || []
  );
  const [taskAssignments, setTaskAssignments] = useState<IProjectTemplateTaskAssignment[]>(
    initialTemplate.task_assignments || []
  );
  const [checklistItems, setChecklistItems] = useState<IProjectTemplateChecklistItem[]>(
    initialTemplate.checklist_items || []
  );
  const [dependencies, setDependencies] = useState<IProjectTemplateDependency[]>(
    initialTemplate.dependencies || []
  );

  // Selection state
  const [selectedPhase, setSelectedPhase] = useState<IProjectTemplatePhase | null>(
    initialTemplate.phases?.[0] || null
  );

  // UI state
  const [isDeleting, setIsDeleting] = useState(false);
  const [showApplyDialog, setShowApplyDialog] = useState(false);
  const [showStatusManager, setShowStatusManager] = useState(false);
  const [showClientPortalConfig, setShowClientPortalConfig] = useState(false);
  const [clientPortalConfig, setClientPortalConfig] = useState<IClientPortalConfig>(
    initialTemplate.client_portal_config || DEFAULT_CLIENT_PORTAL_CONFIG
  );

  // Confirmation dialog state
  const [deletePhaseConfirmation, setDeletePhaseConfirmation] = useState<{
    phaseId: string;
    phaseName: string;
  } | null>(null);
  const [showDeleteTemplateConfirmation, setShowDeleteTemplateConfirmation] = useState(false);
  const [taskToDelete, setTaskToDelete] = useState<IProjectTemplateTask | null>(null);

  // View mode state
  type TemplateViewMode = 'kanban' | 'list';
  const [viewMode, setViewMode] = useState<TemplateViewMode>(() => {
    if (typeof window !== 'undefined') {
      return (localStorage.getItem('template_editor_view_mode') as TemplateViewMode) || 'kanban';
    }
    return 'kanban';
  });

  // Kanban controls state
  const [kanbanZoomLevel, setKanbanZoomLevel] = useState<number>(() => {
    if (typeof window !== 'undefined') {
      return parseInt(localStorage.getItem('template_kanban_zoom_level') || '50', 10);
    }
    return 50;
  });
  const [isHeaderPinned, setIsHeaderPinned] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('template_header_pinned') === 'true';
    }
    return false;
  });
  const [showStickyStatusNames, setShowStickyStatusNames] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('template_sticky_status_names') === 'true';
    }
    return false;
  });
  const [searchQuery, setSearchQuery] = useState('');
  const [showSearchBar, setShowSearchBar] = useState(false);
  const [isPhasesPanelVisible, setIsPhasesPanelVisible] = useState(true);

  // Refs for scroll sync
  const kanbanBoardRef = useRef<HTMLDivElement>(null);
  useKanbanPan(kanbanBoardRef, viewMode === 'kanban');
  const kanbanHeaderRef = useRef<HTMLDivElement>(null);
  const scrollbarProxyRef = useRef<HTMLDivElement>(null);
  const stickyStatusStripRef = useRef<HTMLDivElement>(null);
  const [boardScrollWidth, setBoardScrollWidth] = useState(0);
  const [kanbanHeaderHeight, setKanbanHeaderHeight] = useState(0);

  const kanbanColumnWidth = useMemo(() => calculateColumnWidth(kanbanZoomLevel), [kanbanZoomLevel]);
  const kanbanCardGap = useMemo(() => calculateCardGap(kanbanZoomLevel), [kanbanZoomLevel]);

  // Persist kanban settings to localStorage
  const handleZoomChange = (level: number) => {
    setKanbanZoomLevel(level);
    if (typeof window !== 'undefined') {
      localStorage.setItem('template_kanban_zoom_level', String(level));
    }
  };

  const handleToggleHeaderPinned = () => {
    const next = !isHeaderPinned;
    setIsHeaderPinned(next);
    if (typeof window !== 'undefined') {
      localStorage.setItem('template_header_pinned', String(next));
    }
  };

  const handleToggleStickyStatusNames = () => {
    const next = !showStickyStatusNames;
    setShowStickyStatusNames(next);
    if (typeof window !== 'undefined') {
      localStorage.setItem('template_sticky_status_names', String(next));
    }
  };

  // Proxy scrollbar and sticky status strip: keep horizontal scroll positions in sync
  useEffect(() => {
    const container = kanbanBoardRef.current;
    const proxy = scrollbarProxyRef.current;
    const stickyStrip = stickyStatusStripRef.current;
    if (!container || !proxy) return;

    let isSyncing = false;

    const syncScrollPositions = (source: 'container' | 'proxy' | 'sticky') => {
      if (isSyncing) return;
      isSyncing = true;
      const nextLeft = source === 'container'
        ? container.scrollLeft
        : source === 'proxy'
          ? proxy.scrollLeft
          : (stickyStrip?.scrollLeft ?? 0);

      if (source !== 'container') container.scrollLeft = nextLeft;
      if (source !== 'proxy') proxy.scrollLeft = nextLeft;
      if (stickyStrip && source !== 'sticky') stickyStrip.scrollLeft = nextLeft;
      isSyncing = false;
    };

    const onContainerScroll = () => syncScrollPositions('container');
    const onProxyScroll = () => syncScrollPositions('proxy');
    const onStickyStripScroll = () => syncScrollPositions('sticky');

    container.addEventListener('scroll', onContainerScroll);
    proxy.addEventListener('scroll', onProxyScroll);
    if (stickyStrip) {
      stickyStrip.addEventListener('scroll', onStickyStripScroll);
    }
    syncScrollPositions('container');

    // Track the board's scroll width with ResizeObserver
    const updateWidth = () => {
      setBoardScrollWidth(container.scrollWidth);
    };
    updateWidth();
    const ro = new ResizeObserver(updateWidth);
    ro.observe(container);
    if (container.firstElementChild) {
      ro.observe(container.firstElementChild);
    }

    return () => {
      container.removeEventListener('scroll', onContainerScroll);
      proxy.removeEventListener('scroll', onProxyScroll);
      if (stickyStrip) {
        stickyStrip.removeEventListener('scroll', onStickyStripScroll);
      }
      ro.disconnect();
    };
  }, [showStickyStatusNames, viewMode]);

  // Track header height so the sticky status strip can stack below it
  useEffect(() => {
    const header = kanbanHeaderRef.current;
    if (!header) return;

    const updateHeight = () => {
      setKanbanHeaderHeight(header.getBoundingClientRect().height);
    };
    updateHeight();
    const ro = new ResizeObserver(updateHeight);
    ro.observe(header);
    return () => ro.disconnect();
  }, [isHeaderPinned, viewMode]);

  // Persist view mode to localStorage
  const handleViewModeChange = (mode: TemplateViewMode) => {
    setViewMode(mode);
    if (typeof window !== 'undefined') {
      localStorage.setItem('template_editor_view_mode', mode);
    }
  };

  const viewOptions = [
    { value: 'kanban' as const, label: t('kanbanView', 'Kanban'), icon: LayoutGrid },
    { value: 'list' as const, label: t('listView', 'List'), icon: List },
  ];

  // Phase editing state
  const [editingPhaseId, setEditingPhaseId] = useState<string | null>(null);
  const [editingPhaseName, setEditingPhaseName] = useState('');
  const [editingPhaseDescription, setEditingPhaseDescription] = useState('');
  const [editingPhaseDuration, setEditingPhaseDuration] = useState<number | undefined>();
  const [editingPhaseOffset, setEditingPhaseOffset] = useState<number>(0);

  // Task form state
  const [showTaskForm, setShowTaskForm] = useState(false);
  const [editingTask, setEditingTask] = useState<IProjectTemplateTask | null>(null);
  const [newTaskStatusMappingId, setNewTaskStatusMappingId] = useState<string | null>(null);

  // Drag state
  const [draggedPhaseId, setDraggedPhaseId] = useState<string | null>(null);
  const [draggedTaskId, setDraggedTaskId] = useState<string | null>(null);
  const [phaseDropTarget, setPhaseDropTarget] = useState<string | null>(null);

  // Reference data
  const [availableStatuses, setAvailableStatuses] = useState<
    Array<{ status_id: string; name: string; color?: string; is_closed?: boolean }>
  >([]);
  const [priorities, setPriorities] = useState<Array<{ priority_id: string; priority_name: string; color?: string }>>([]);
  const [users, setUsers] = useState<IUserWithRoles[]>([]);
  const [taskTypes, setTaskTypes] = useState<ITaskType[]>([]);
  const [avatarUrls, setAvatarUrls] = useState<Record<string, string | null>>({});

  // Load reference data
  useEffect(() => {
    const loadReferenceData = async () => {
      try {
        const [statuses, priorityList, userList, taskTypeList] = await Promise.all([
          getTenantProjectStatuses(),
          getAllPriorities('project_task'),
          getAllUsers(true, 'internal'),
          getTaskTypes(),
        ]);
        setAvailableStatuses(
          statuses.map((s) => ({
            status_id: s.status_id,
            name: s.name,
            color: s.color || undefined,
            is_closed: s.is_closed,
          }))
        );
        setPriorities(
          priorityList.map((p) => ({
            priority_id: p.priority_id,
            priority_name: p.priority_name,
            color: p.color,
          }))
        );
        setUsers(userList);
        setTaskTypes(taskTypeList);
      } catch (error) {
        console.error('Failed to load reference data:', error);
      }
    };
    loadReferenceData();
  }, []);

  // Fetch avatar URLs for task assignees
  useEffect(() => {
    const fetchAvatarUrls = async () => {
      const userIds = new Set<string>();
      taskAssignments.forEach(assignment => {
        if (assignment.user_id) {
          userIds.add(assignment.user_id);
        }
      });
      if (userIds.size === 0) return;
      if (!template.tenant) return;

      try {
        const avatarUrlsMap = await getUserAvatarUrlsBatchAction(Array.from(userIds), template.tenant);
        const urlsRecord: Record<string, string | null> = {};
        avatarUrlsMap.forEach((url, id) => {
          urlsRecord[id] = url;
        });
        setAvatarUrls(urlsRecord);
      } catch (error) {
        console.error('Failed to fetch avatar URLs:', error);
      }
    };
    fetchAvatarUrls();
  }, [taskAssignments, template.tenant]);

  // Teams-v2: fetch teams and team avatar URLs
  const { enabled: teamsV2Enabled } = useFeatureFlag('teams-v2', { defaultValue: false });
  const [teamNames, setTeamNames] = useState<Record<string, string>>({});
  const [teamAvatarUrls, setTeamAvatarUrls] = useState<Record<string, string | null>>({});

  useEffect(() => {
    if (!teamsV2Enabled) return;
    const fetchTeams = async () => {
      try {
        const fetchedTeams = await getTeams();
        const names: Record<string, string> = {};
        fetchedTeams.forEach((t: ITeam) => { names[t.team_id] = t.team_name; });
        setTeamNames(names);

        const teamIds = fetchedTeams.map((t: ITeam) => t.team_id);
        if (teamIds.length > 0) {
          const avatarResult = await getTeamAvatarUrlsBatchAction(teamIds, template.tenant!);
          const urls: Record<string, string | null> = {};
          if (avatarResult instanceof Map) {
            avatarResult.forEach((url, id) => { urls[id] = url; });
          } else {
            Object.entries(avatarResult).forEach(([id, url]) => { urls[id] = url as string | null; });
          }
          setTeamAvatarUrls(urls);
        }
      } catch (error) {
        console.error('Failed to fetch teams:', error);
      }
    };
    fetchTeams();
  }, [teamsV2Enabled]);

  // ============================================================
  // TEMPLATE ACTIONS
  // ============================================================

  async function handleDeleteTemplate() {
    try {
      setIsDeleting(true);
      await deleteTemplate(template.template_id);
      toast.success(t('templates.editor.deletedSuccess', 'Template deleted successfully'));
      router.push('/msp/projects/templates');
    } catch (error) {
      handleError(error, t('templates.editor.deleteFailed', 'Failed to delete template'));
    } finally {
      setIsDeleting(false);
      setShowDeleteTemplateConfirmation(false);
    }
  }

  const handleClientPortalConfigChange = async (config: IClientPortalConfig) => {
    try {
      setClientPortalConfig(config);
      await updateTemplate(template.template_id, { client_portal_config: config });
      toast.success(t('templates.editor.clientPortalSaved', 'Client portal settings saved'));
    } catch (error) {
      handleError(error, t('templates.editor.clientPortalSaveFailed', 'Failed to save client portal settings'));
    }
  };

  // ============================================================
  // PHASE ACTIONS
  // ============================================================

  const handleAddPhase = async () => {
    try {
      const newPhase = await addTemplatePhase(template.template_id, {
        phase_name: '',
        description: '',
        duration_days: undefined,
        start_offset_days: 0,
      });
      setPhases((prev) => [...prev, newPhase]);
      setSelectedPhase(newPhase);
      // Start editing immediately with empty name
      setEditingPhaseId(newPhase.template_phase_id);
      setEditingPhaseName('');
      setEditingPhaseDescription('');
      setEditingPhaseDuration(undefined);
      setEditingPhaseOffset(0);
    } catch (error) {
      handleError(error, t('templates.editor.addPhaseFailed', 'Failed to add phase'));
    }
  };

  const handleEditPhase = (phase: IProjectTemplatePhase) => {
    setEditingPhaseId(phase.template_phase_id);
    setEditingPhaseName(phase.phase_name);
    setEditingPhaseDescription(phase.description || '');
    setEditingPhaseDuration(phase.duration_days || undefined);
    setEditingPhaseOffset(phase.start_offset_days || 0);
  };

  const handleSavePhase = async (phase: IProjectTemplatePhase) => {
    try {
      const updated = await updateTemplatePhase(phase.template_phase_id, {
        phase_name: editingPhaseName,
        description: editingPhaseDescription || undefined,
        duration_days: editingPhaseDuration,
        start_offset_days: editingPhaseOffset,
      });
      setPhases((prev) =>
        prev.map((p) => (p.template_phase_id === phase.template_phase_id ? updated : p))
      );
      if (selectedPhase?.template_phase_id === phase.template_phase_id) {
        setSelectedPhase(updated);
      }
      setEditingPhaseId(null);
      toast.success(t('templates.editor.phaseUpdated', 'Phase updated'));
    } catch (error) {
      handleError(error, t('templates.editor.updatePhaseFailed', 'Failed to update phase'));
    }
  };

  const handleDeletePhaseClick = (phase: IProjectTemplatePhase) => {
    setDeletePhaseConfirmation({
      phaseId: phase.template_phase_id,
      phaseName: phase.phase_name,
    });
  };

  const handleDeletePhase = async () => {
    if (!deletePhaseConfirmation) return;
    try {
      await deleteTemplatePhase(deletePhaseConfirmation.phaseId);
      setPhases((prev) => prev.filter((p) => p.template_phase_id !== deletePhaseConfirmation.phaseId));
      setTasks((prev) => prev.filter((t) => t.template_phase_id !== deletePhaseConfirmation.phaseId));
      if (selectedPhase?.template_phase_id === deletePhaseConfirmation.phaseId) {
        setSelectedPhase(phases.find((p) => p.template_phase_id !== deletePhaseConfirmation.phaseId) || null);
      }
      toast.success(t('templates.editor.phaseDeleted', 'Phase deleted'));
    } catch (error) {
      handleError(error, t('templates.editor.deletePhaseFailed', 'Failed to delete phase'));
    } finally {
      setDeletePhaseConfirmation(null);
    }
  };

  // ============================================================
  // PHASE DRAG AND DROP
  // ============================================================

  const handlePhaseDragStart = (e: React.DragEvent, phaseId: string) => {
    setDraggedPhaseId(phaseId);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('application/json', JSON.stringify({ type: 'phase', phaseId }));
  };

  const handlePhaseDragOver = (e: React.DragEvent, targetPhaseId: string) => {
    e.preventDefault();
    // Accept both phase drag and task drag
    if ((draggedPhaseId && draggedPhaseId !== targetPhaseId) || draggedTaskId) {
      setPhaseDropTarget(targetPhaseId);
    }
  };

  const handlePhaseDragLeave = () => {
    setPhaseDropTarget(null);
  };

  const handlePhaseDrop = async (e: React.DragEvent, targetPhase: IProjectTemplatePhase) => {
    e.preventDefault();
    setPhaseDropTarget(null);

    // Handle task drop - move task to another phase
    if (draggedTaskId) {
      const task = tasks.find((t) => t.template_task_id === draggedTaskId);
      if (!task || task.template_phase_id === targetPhase.template_phase_id) {
        setDraggedTaskId(null);
        return;
      }

      try {
        // Move task to the target phase
        const updated = await updateTemplateTask(draggedTaskId, {
          template_phase_id: targetPhase.template_phase_id,
        });
        setTasks((prev) =>
          prev.map((t) => (t.template_task_id === draggedTaskId ? updated : t))
        );
        toast.success(t('templates.editor.taskMovedToPhase', 'Task moved to "{{phaseName}}"', {
          phaseName: targetPhase.phase_name,
        }));
      } catch (error) {
        handleError(error, t('templates.editor.moveTaskFailed', 'Failed to move task'));
      } finally {
        setDraggedTaskId(null);
        document.body.classList.remove('dragging-task');
      }
      return;
    }

    // Handle phase reorder
    if (!draggedPhaseId || draggedPhaseId === targetPhase.template_phase_id) {
      setDraggedPhaseId(null);
      return;
    }

    try {
      // Sort phases to find positions
      const sortedPhases = [...phases].sort((a, b) => (a.order_key || '').localeCompare(b.order_key || ''));
      const targetIndex = sortedPhases.findIndex((p) => p.template_phase_id === targetPhase.template_phase_id);
      const draggedIndex = sortedPhases.findIndex((p) => p.template_phase_id === draggedPhaseId);

      // Determine before/after phase IDs
      let beforePhaseId: string | null = null;
      let afterPhaseId: string | null = null;

      if (draggedIndex < targetIndex) {
        // Moving down
        beforePhaseId = targetPhase.template_phase_id;
        afterPhaseId = sortedPhases[targetIndex + 1]?.template_phase_id || null;
      } else {
        // Moving up
        beforePhaseId = sortedPhases[targetIndex - 1]?.template_phase_id || null;
        afterPhaseId = targetPhase.template_phase_id;
      }

      const updated = await reorderTemplatePhase(draggedPhaseId, beforePhaseId, afterPhaseId);

      setPhases((prev) =>
        prev.map((p) => (p.template_phase_id === draggedPhaseId ? updated : p))
      );
    } catch (error) {
      handleError(error, t('templates.editor.reorderPhaseFailed', 'Failed to reorder phase'));
    } finally {
      setDraggedPhaseId(null);
    }
  };

  const handlePhaseDragEnd = () => {
    setDraggedPhaseId(null);
    setPhaseDropTarget(null);
  };

  // ============================================================
  // TASK ACTIONS
  // ============================================================

  const handleAddTask = (statusMappingId?: string) => {
    if (!selectedPhase) {
      toast.error(t('templates.editor.selectPhaseFirst', 'Please select a phase first'));
      return;
    }
    setEditingTask(null);
    setNewTaskStatusMappingId(statusMappingId || statusMappings[0]?.template_status_mapping_id || null);
    setShowTaskForm(true);
  };

  const handleEditTask = (task: IProjectTemplateTask) => {
    setEditingTask(task);
    setShowTaskForm(true);
  };

  const handleSaveTask = async (
    taskData: Partial<IProjectTemplateTask>,
    additionalAgents?: string[],
    localChecklistItems?: Array<{ id: string; item_name: string; description?: string; completed: boolean; order_number: number; isNew?: boolean }>,
    dependencyChanges?: {
      added: Array<{ predecessorTaskId: string; dependencyType: DependencyType }>;
      removed: string[];
    }
  ) => {
    try {
      let taskId: string;

      if (editingTask) {
        // Update existing task
        const updated = await updateTemplateTask(editingTask.template_task_id, taskData);
        setTasks((prev) =>
          prev.map((t) => (t.template_task_id === editingTask.template_task_id ? updated : t))
        );
        taskId = editingTask.template_task_id;
        toast.success(t('templates.editor.taskUpdated', 'Task updated'));
      } else if (selectedPhase) {
        // Create new task - use newTaskStatusMappingId if set, otherwise from taskData or first status
        const statusMappingIdToUse = taskData.template_status_mapping_id || newTaskStatusMappingId || statusMappings[0]?.template_status_mapping_id;
        const newTask = await addTemplateTask(selectedPhase.template_phase_id, {
          task_name: taskData.task_name || t('templates.editor.newTaskFallback', 'New Task'),
          description: taskData.description,
          estimated_hours: taskData.estimated_hours,
          duration_days: taskData.duration_days,
          task_type_key: taskData.task_type_key,
          priority_id: taskData.priority_id,
          assigned_to: taskData.assigned_to,
          assigned_team_id: taskData.assigned_team_id,
          template_status_mapping_id: statusMappingIdToUse,
          service_id: taskData.service_id,
        });
        setTasks((prev) => [...prev, newTask]);
        taskId = newTask.template_task_id;
        toast.success(t('templates.editor.taskCreated', 'Task created'));
      } else {
        return;
      }

      // Save additional agents if provided
      if (additionalAgents !== undefined) {
        await setTaskAdditionalAgents(taskId, additionalAgents);
        // Update local state
        setTaskAssignments((prev) => {
          // Remove old assignments for this task
          const filtered = prev.filter((a) => a.template_task_id !== taskId);
          // Add new assignments
          const newAssignments = additionalAgents.map((userId) => ({
            template_assignment_id: `temp-${taskId}-${userId}`,
            template_task_id: taskId,
            user_id: userId,
            tenant: template.tenant,
            is_primary: false,
          }));
          return [...filtered, ...newAssignments];
        });
      }

      // Handle checklist items - all operations in a single transaction
      // Note: Items with "temp_" prefix ids are client-generated temporary ids for new items
      if (localChecklistItems) {
        const savedItems = await saveTemplateChecklistItems(taskId, localChecklistItems);

        // Update local state - remove old items for this task and add saved ones
        setChecklistItems((prev) => {
          const otherTaskItems = prev.filter(c => c.template_task_id !== taskId);
          return [...otherTaskItems, ...savedItems];
        });
      }

      // Handle dependency changes
      if (dependencyChanges) {
        // Remove dependencies
        for (const depId of dependencyChanges.removed) {
          await removeTemplateDependency(depId);
          setDependencies((prev) => prev.filter((d) => d.template_dependency_id !== depId));
        }

        // Add new dependencies (current task is the successor)
        for (const dep of dependencyChanges.added) {
          const newDep = await addTemplateDependency(
            template.template_id,
            dep.predecessorTaskId,
            taskId,
            dep.dependencyType
          );
          setDependencies((prev) => [...prev, newDep]);
        }
      }

      setShowTaskForm(false);
      setEditingTask(null);
    } catch (error) {
      handleError(error, t('templates.editor.taskSaveFailed', 'Failed to save task'));
    }
  };

  const handleDeleteTaskClick = (task: IProjectTemplateTask) => {
    setTaskToDelete(task);
  };

  const handleDeleteTask = async () => {
    if (!taskToDelete) return;
    try {
      await deleteTemplateTask(taskToDelete.template_task_id);
      setTasks((prev) => prev.filter((t) => t.template_task_id !== taskToDelete.template_task_id));
      toast.success(t('templates.editor.taskDeleted', 'Task deleted'));
    } catch (error) {
      handleError(error, t('templates.editor.deleteTaskFailed', 'Failed to delete task'));
    } finally {
      setTaskToDelete(null);
    }
  };

  // ============================================================
  // TASK DRAG AND DROP
  // ============================================================

  const handleTaskDragStart = (e: React.DragEvent, taskId: string) => {
    setDraggedTaskId(taskId);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', taskId);
  };

  const handleTaskDragEnd = () => {
    setDraggedTaskId(null);
  };

  const handleTaskDrop = async (
    e: React.DragEvent,
    targetStatusMappingId: string,
    beforeTaskId: string | null,
    afterTaskId: string | null
  ) => {
    e.preventDefault();

    if (!draggedTaskId) return;

    const task = tasks.find((t) => t.template_task_id === draggedTaskId);
    if (!task) return;

    // Only update if status changed or position changed
    if (task.template_status_mapping_id === targetStatusMappingId && !beforeTaskId && !afterTaskId) {
      setDraggedTaskId(null);
      return;
    }

    try {
      const updated = await updateTemplateTaskStatus(draggedTaskId, targetStatusMappingId, beforeTaskId, afterTaskId);
      setTasks((prev) =>
        prev.map((t) => (t.template_task_id === draggedTaskId ? updated : t))
      );
    } catch (error) {
      handleError(error, t('templates.editor.moveTaskFailed', 'Failed to move task'));
    } finally {
      setDraggedTaskId(null);
    }
  };

  // Handler for list view drag and drop
  const handleTaskMove = async (
    taskId: string,
    newStatusMappingId: string,
    newPhaseId: string,
    beforeTaskId: string | null,
    afterTaskId: string | null
  ): Promise<void> => {
    const task = tasks.find((t) => t.template_task_id === taskId);
    if (!task) return;

    const isPhaseChanging = newPhaseId && task.template_phase_id !== newPhaseId;
    const isStatusChanging = task.template_status_mapping_id !== newStatusMappingId;

    // Skip if no change
    if (!isPhaseChanging && !isStatusChanging && !beforeTaskId && !afterTaskId) {
      return;
    }

    try {
      // If phase is changing, use updateTemplateTask which can update both phase and status
      if (isPhaseChanging) {
        const updated = await updateTemplateTask(taskId, {
          template_phase_id: newPhaseId,
          template_status_mapping_id: newStatusMappingId,
        });
        setTasks((prev) =>
          prev.map((t) => (t.template_task_id === taskId ? updated : t))
        );
      } else {
        // Just status/order change
        const updated = await updateTemplateTaskStatus(taskId, newStatusMappingId, beforeTaskId, afterTaskId);
        setTasks((prev) =>
          prev.map((t) => (t.template_task_id === taskId ? updated : t))
        );
      }
    } catch (error) {
      handleError(error, t('templates.editor.moveTaskFailed', 'Failed to move task'));
    }
  };

  const handleAssigneeChange = async (taskId: string, assigneeId: string | null) => {
    try {
      const updated = await updateTemplateTask(taskId, { assigned_to: assigneeId });
      setTasks((prev) => prev.map((t) => (t.template_task_id === taskId ? updated : t)));
    } catch (error) {
      handleError(error, t('templates.editor.updateAssigneeFailed', 'Failed to update assignee'));
    }
  };

  // ============================================================
  // STATUS MANAGEMENT
  // ============================================================

  const handleStatusAdded = (newMapping: IProjectTemplateStatusMapping) => {
    setStatusMappings((prev) => [...prev, newMapping]);
  };

  const handleStatusRemoved = (mappingId: string) => {
    setStatusMappings((prev) => prev.filter((m) => m.template_status_mapping_id !== mappingId));
    // Clear status from tasks that used this mapping
    setTasks((prev) =>
      prev.map((t) =>
        t.template_status_mapping_id === mappingId ? { ...t, template_status_mapping_id: undefined } : t
      )
    );
  };

  const handlePhaseStatusesRemoved = (templatePhaseId: string) => {
    const removedMappingIds = statusMappings
      .filter((mapping) => mapping.template_phase_id === templatePhaseId)
      .map((mapping) => mapping.template_status_mapping_id);

    setStatusMappings((prev) =>
      prev.filter((mapping) => mapping.template_phase_id !== templatePhaseId)
    );
    setTasks((prev) =>
      prev.map((task) =>
        removedMappingIds.includes(task.template_status_mapping_id || '')
          ? { ...task, template_status_mapping_id: undefined }
          : task
      )
    );
  };

  const handleStatusReordered = (
    orderedMappingIds: string[],
    templatePhaseId?: string | null
  ) => {
    setStatusMappings((prev) => {
      const mappingMap = new Map(prev.map((m) => [m.template_status_mapping_id, m]));
      const reorderedScopeMappings = orderedMappingIds
        .map((id, index) => {
          const mapping = mappingMap.get(id);
          return mapping ? { ...mapping, display_order: index } : null;
        })
        .filter((m): m is IProjectTemplateStatusMapping => m !== null);

      const reorderedIds = new Set(orderedMappingIds);
      const untouchedMappings = prev.filter((mapping) => {
        const isSameScope = templatePhaseId
          ? mapping.template_phase_id === templatePhaseId
          : !mapping.template_phase_id;

        return !isSameScope && !reorderedIds.has(mapping.template_status_mapping_id);
      });

      return [...untouchedMappings, ...reorderedScopeMappings];
    });
  };

  // ============================================================
  // RENDER
  // ============================================================

  const sortedPhases = [...phases].sort((a, b) => (a.order_key || '').localeCompare(b.order_key || ''));
  const sortedStatusMappings = useMemo(
    () => getEffectiveTemplateStatusMappings(statusMappings, selectedPhase?.template_phase_id),
    [statusMappings, selectedPhase?.template_phase_id]
  );

  // Compute task counts per phase
  const phaseTaskCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    phases.forEach(phase => {
      counts[phase.template_phase_id] = tasks.filter(
        task => task.template_phase_id === phase.template_phase_id
      ).length;
    });
    return counts;
  }, [phases, tasks]);

  // Compute task counts per status mapping for the selected phase
  const statusTaskCounts = useMemo(() => {
    if (!selectedPhase) return {} as Record<string, number>;
    const pTasks = tasks.filter((t) => t.template_phase_id === selectedPhase.template_phase_id);
    return pTasks.reduce<Record<string, number>>((counts, task) => {
      const key = task.template_status_mapping_id || sortedStatusMappings[0]?.template_status_mapping_id || '';
      counts[key] = (counts[key] ?? 0) + 1;
      return counts;
    }, {});
  }, [tasks, selectedPhase, sortedStatusMappings]);

  // Styling helper for sticky status strip items
  const getStatusStripStyles = useCallback((statusColor: string) => {
    const isDarkTheme = resolvedTheme === 'dark';
    if (isDarkTheme) {
      return {
        itemStyle: {
          backgroundColor: darkenColor(statusColor, 0.75),
          borderColor: darkenColor(statusColor, 0.55),
          color: lightenColor(statusColor, 0.40),
        } as React.CSSProperties,
        countStyle: {
          backgroundColor: darkenColor(statusColor, 0.65),
          color: lightenColor(statusColor, 0.40),
        } as React.CSSProperties,
      };
    }
    return {
      itemStyle: {
        backgroundColor: lightenColor(statusColor, 0.85),
        borderColor: lightenColor(statusColor, 0.45),
        color: statusColor,
      } as React.CSSProperties,
      countStyle: {
        backgroundColor: lightenColor(statusColor, 0.62),
        color: statusColor,
      } as React.CSSProperties,
    };
  }, [resolvedTheme]);

  const phaseTasks = selectedPhase
    ? tasks.filter((task) => task.template_phase_id === selectedPhase.template_phase_id)
    : [];

  // Filter tasks by search query
  const filteredPhaseTasks = useMemo(() => {
    if (!searchQuery.trim()) return phaseTasks;
    const query = searchQuery.toLowerCase();
    return phaseTasks.filter((task) =>
      task.task_name.toLowerCase().includes(query) ||
      (task.description && task.description.toLowerCase().includes(query))
    );
  }, [phaseTasks, searchQuery]);

  return (
    <>
      <ApplyTemplateDialog
        open={showApplyDialog}
        onClose={() => setShowApplyDialog(false)}
        onSuccess={(projectId) => {
          setShowApplyDialog(false);
          router.push(`/msp/projects/${projectId}`);
        }}
        initialTemplateId={template.template_id}
      />

      {showTaskForm && (
        <TemplateTaskForm
          open={showTaskForm}
          onClose={() => {
            setShowTaskForm(false);
            setEditingTask(null);
            setNewTaskStatusMappingId(null);
          }}
          onSave={handleSaveTask}
          task={editingTask}
          taskAssignments={taskAssignments}
          statusMappings={statusMappings}
          priorities={priorities}
          users={users}
          taskTypes={taskTypes}
          initialStatusMappingId={newTaskStatusMappingId}
          checklistItems={editingTask ? checklistItems.filter(c => c.template_task_id === editingTask.template_task_id) : []}
          allTasks={tasks}
          dependencies={editingTask ? dependencies.filter(d => d.successor_task_id === editingTask.template_task_id) : []}
          tenant={template.tenant}
        />
      )}

      {showStatusManager && (
        <TemplateStatusManager
          open={showStatusManager}
          onClose={() => setShowStatusManager(false)}
          templateId={template.template_id}
          phases={phases}
          statusMappings={statusMappings}
          availableStatuses={availableStatuses}
          taskCountByMapping={statusTaskCounts}
          onStatusAdded={handleStatusAdded}
          onStatusRemoved={(mappingId, moveTasksToMappingId) => {
            if (moveTasksToMappingId) {
              setTasks(prev => prev.map(task =>
                task.template_status_mapping_id === mappingId
                  ? { ...task, template_status_mapping_id: moveTasksToMappingId }
                  : task
              ));
            }
            handleStatusRemoved(mappingId);
          }}
          onPhaseStatusesRemoved={handlePhaseStatusesRemoved}
          onStatusReordered={handleStatusReordered}
        />
      )}

      {showDeleteTemplateConfirmation && (
        <ConfirmationDialog
          isOpen={true}
          onClose={() => setShowDeleteTemplateConfirmation(false)}
          onConfirm={handleDeleteTemplate}
          title={t('templates.editor.deleteTemplateTitle', 'Delete Template')}
          message={t('templates.list.deleteMessage', 'Are you sure you want to delete template "{{templateName}}"? This action cannot be undone.', {
            templateName: template.template_name,
          })}
          confirmLabel={t('common:actions.delete', 'Delete')}
          cancelLabel={t('common:actions.cancel', 'Cancel')}
        />
      )}

      {deletePhaseConfirmation && (
        <ConfirmationDialog
          isOpen={true}
          onClose={() => setDeletePhaseConfirmation(null)}
          onConfirm={handleDeletePhase}
          title={t('templates.editor.deletePhaseTitle', 'Delete Phase')}
          message={t('templates.editor.deletePhaseMessage', 'Are you sure you want to delete phase "{{phaseName}}"? This will also delete all tasks in this phase.', {
            phaseName: deletePhaseConfirmation.phaseName,
          })}
          confirmLabel={t('common:actions.delete', 'Delete')}
          cancelLabel={t('common:actions.cancel', 'Cancel')}
        />
      )}

      {taskToDelete && (
        <ConfirmationDialog
          isOpen={true}
          onClose={() => setTaskToDelete(null)}
          onConfirm={handleDeleteTask}
          title={t('templates.editor.deleteTaskTitle', 'Delete Task')}
          message={t('templates.editor.deleteTaskMessage', 'Are you sure you want to delete task "{{taskName}}"?', {
            taskName: taskToDelete.task_name,
          })}
          confirmLabel={t('common:actions.delete', 'Delete')}
          cancelLabel={t('common:actions.cancel', 'Cancel')}
        />
      )}

      <div className={styles.pageContainer}>
        {/* Template Header */}
        <div className="border-b px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Button
                id="back-to-templates"
                variant="soft"
                onClick={() => router.push('/msp/projects/templates')}
              >
                <ArrowLeft className="h-4 w-4 mr-2" />
                {t('common:actions.back', 'Back')}
              </Button>
              <div className="flex items-center gap-3">
                <Badge variant="secondary" className="flex items-center gap-1">
                  <FileText className="h-3 w-3" />
                  {t('templates.editor.templateBadge', 'Template')}
                </Badge>
                <h1 className="text-2xl font-bold">{template.template_name}</h1>
              </div>
            </div>
            <div className="flex gap-2 items-center">
              <ViewSwitcher
                currentView={viewMode}
                onChange={handleViewModeChange}
                options={viewOptions}
              />
              <Button id="use-template" onClick={() => setShowApplyDialog(true)}>
                <Rocket className="h-4 w-4 mr-2" />
                {t('templates.editor.useTemplate', 'Use Template')}
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    id="template-actions-button"
                    variant="outline"
                    className="flex items-center gap-2"
                  >
                    <MoreVertical className="h-4 w-4" />
                    {t('projectList.columns.actions', 'Actions')}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onSelect={() => setShowStatusManager(true)}>
                    <Settings className="h-4 w-4 mr-2" />
                    {t('templates.editor.statusColumnsLabel', 'Status Columns')}
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => setShowClientPortalConfig(true)}>
                    <Users className="h-4 w-4 mr-2" />
                    {t('templates.editor.clientPortalVisibility', 'Client Portal Visibility')}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={() => setShowDeleteTemplateConfirmation(true)}
                    disabled={isDeleting}
                    className="text-destructive focus:text-destructive focus:bg-destructive/10"
                  >
                    <Trash className="h-4 w-4 mr-2" />
                    {t('templates.editor.deleteTemplateTitle', 'Delete Template')}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>

          {/* Template metadata */}
          <div className="mt-2 flex items-center justify-between gap-4">
            {template.description && (
              <p className="text-sm text-gray-600 flex-1 min-w-0">
                <span className="font-medium">{t('templates.detail.description', 'Description:')}</span> {template.description}
              </p>
            )}
            <Badge variant="secondary" className="text-xs shrink-0">
              {t('templates.detail.usedCount', 'Used: {{count}} times', { count: template.use_count })}
            </Badge>
          </div>

          {/* Client Portal Visibility Dialog */}
          <Dialog
            isOpen={showClientPortalConfig}
            onClose={() => setShowClientPortalConfig(false)}
            title={t('templates.editor.clientPortalVisibility', 'Client Portal Visibility')}
            id="template-client-portal-config-dialog"
            className="max-w-lg"
          >
            <div className="p-4">
              <ClientPortalConfigEditor
                config={clientPortalConfig}
                onChange={handleClientPortalConfigChange}
              />
              <div className="flex justify-end mt-4">
                <Button
                  id="close-template-client-portal-config"
                  type="button"
                  onClick={() => setShowClientPortalConfig(false)}
                >
                  {t('templates.editor.done', 'Done')}
                </Button>
              </div>
            </div>
          </Dialog>
        </div>

        <div
          className={styles.mainContent}
          style={viewMode !== 'kanban' ? { flex: '0 0 auto', minHeight: 'auto' } : undefined}
        >
          {viewMode === 'list' ? (
            /* List View - Full Width */
            <div className="p-4 h-full">
              <TemplateTaskListView
                phases={sortedPhases}
                tasks={tasks}
                statusMappings={sortedStatusMappings}
                checklistItems={checklistItems}
                dependencies={dependencies}
                taskAssignments={taskAssignments}
                users={users}
                taskTypes={taskTypes}
                priorities={priorities}
                onTaskClick={handleEditTask}
                onTaskDelete={handleDeleteTaskClick}
                onAddPhase={handleAddPhase}
                onAddTask={(phaseId, statusMappingId) => {
                  const phase = phases.find((p) => p.template_phase_id === phaseId);
                  if (phase) {
                    setSelectedPhase(phase);
                  }
                  handleAddTask(statusMappingId);
                }}
                onTaskMove={handleTaskMove}
                onAssigneeChange={handleAssigneeChange}
                teamNames={teamNames}
                teamAvatarUrls={teamAvatarUrls}
              />
            </div>
          ) : (
            /* Kanban View - Phases sidebar + Kanban board */
            <div
              className={styles.contentWrapper}
              style={viewMode !== 'kanban' ? { flex: '0 0 auto', minHeight: 'auto', alignItems: 'flex-start' } : undefined}
            >
              {/* Collapsible Phases Panel */}
              <div className={`${styles.phasesContainer} ${isPhasesPanelVisible ? styles.phasesContainerExpanded : styles.phasesContainerCollapsed}`}>
                <CollapseToggleButton
                  id="toggle-phases-panel"
                  isCollapsed={!isPhasesPanelVisible}
                  collapsedLabel={t('projectDetail.showPhasesPanel', 'Show phases panel')}
                  expandedLabel={t('projectDetail.hidePhasesPanel', 'Hide phases panel')}
                  className={styles.phasesPanelToggle}
                  onClick={() => setIsPhasesPanelVisible(!isPhasesPanelVisible)}
                />
                <div className={`${styles.phasesList} ${isPhasesPanelVisible ? styles.phasesListVisible : styles.phasesListHidden}`}>
                  <div className={styles.phasesPanel}>
                    <div className={styles.phasesPanelHeader}>
                      <h2 className="text-xl font-bold mb-2">{t('templates.editor.projectPhases', 'Project Phases')}</h2>
                      <div className="flex gap-2 flex-wrap">
                        <Button
                          id="add-task-from-phases-panel"
                          onClick={() => handleAddTask()}
                          size="sm"
                          disabled={!selectedPhase}
                        >
                          + {t('projectPhases.addTask', 'Add Task')}
                        </Button>
                        <Button id="add-phase" variant="default" size="sm" onClick={handleAddPhase}>
                          + {t('projectPhases.addPhase', 'Add Phase')}
                        </Button>
                      </div>
                    </div>
                    <ul className={styles.phasesScrollArea}>
                    {sortedPhases.length === 0 ? (
                      <div className="text-sm text-gray-500 text-center py-4">
                        {t('templates.editor.noPhasesYet', 'No phases yet.')}
                        <br />
                        <Button
                          id="add-first-phase"
                          variant="ghost"
                          size="sm"
                          className="text-purple-600 hover:text-purple-700 mt-1"
                          onClick={handleAddPhase}
                        >
                          {t('templates.editor.addFirstPhase', 'Add your first phase')}
                        </Button>
                      </div>
                    ) : (
                      sortedPhases.map((phase) => {
                        const isDropTarget = phaseDropTarget === phase.template_phase_id;
                        const isTaskDrop = isDropTarget && draggedTaskId;
                        const isPhaseDrop = isDropTarget && draggedPhaseId;
                        const isCurrentPhaseForTask = draggedTaskId &&
                          tasks.find((t) => t.template_task_id === draggedTaskId)?.template_phase_id === phase.template_phase_id;

                        return (
                        <li
                          key={phase.template_phase_id}
                          draggable={editingPhaseId !== phase.template_phase_id}
                          onDragStart={(e) => handlePhaseDragStart(e, phase.template_phase_id)}
                          onDragOver={(e) => handlePhaseDragOver(e, phase.template_phase_id)}
                          onDragLeave={handlePhaseDragLeave}
                          onDrop={(e) => handlePhaseDrop(e, phase)}
                          onDragEnd={handlePhaseDragEnd}
                          className={`${styles.phaseItem} relative flex items-center justify-between px-3 py-2.5 rounded-md cursor-pointer group ${
                            selectedPhase?.template_phase_id === phase.template_phase_id
                              ? 'bg-purple-50 dark:bg-purple-500/10'
                              : 'hover:bg-gray-50 dark:hover:bg-[rgb(var(--color-border-100))]'
                          } ${draggedPhaseId === phase.template_phase_id ? 'opacity-50' : ''} ${
                            isPhaseDrop ? styles.dragOver + ' ring-2 ring-purple-400' : ''
                          } ${
                            isTaskDrop && !isCurrentPhaseForTask
                              ? 'ring-2 ring-blue-400 bg-primary/10 scale-[1.02]'
                              : ''
                          }`}
                          onClick={() => {
                            if (editingPhaseId !== phase.template_phase_id) {
                              setSelectedPhase(phase);
                            }
                          }}
                        >
                          {editingPhaseId === phase.template_phase_id ? (
                            <div className="flex flex-col w-full gap-3" onClick={(e) => e.stopPropagation()}>
                              <div className="flex-1 min-w-0">
                                <div>
                                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">{t('templates.editor.phaseName', 'Phase Name')}</label>
                                  <Input
                                    value={editingPhaseName}
                                    onChange={(e) => setEditingPhaseName(e.target.value)}
                                    placeholder={t('templates.editor.phaseNamePlaceholder', 'Phase name')}
                                    autoFocus
                                  />
                                </div>
                                <div>
                                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">{t('templates.editor.phaseDescription', 'Phase Description')}</label>
                                  <TextArea
                                    value={editingPhaseDescription}
                                    onChange={(e) => setEditingPhaseDescription(e.target.value)}
                                    placeholder={t('templates.editor.phaseDescriptionPlaceholder', 'Description (optional)')}
                                    rows={2}
                                  />
                                </div>
                                <div className="grid grid-cols-2 gap-2">
                                  <div>
                                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">{t('templates.editor.duration', 'Duration')}</label>
                                    <Input
                                      type="number"
                                      value={editingPhaseDuration || ''}
                                      onChange={(e) =>
                                        setEditingPhaseDuration(e.target.value ? parseInt(e.target.value) : undefined)
                                      }
                                      placeholder={t('templates.editor.daysPlaceholder', 'Days')}
                                    />
                                  </div>
                                  <div>
                                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">{t('templates.editor.startOffset', 'Start offset')}</label>
                                    <Input
                                      type="number"
                                      value={editingPhaseOffset}
                                      onChange={(e) => setEditingPhaseOffset(parseInt(e.target.value) || 0)}
                                      placeholder={t('templates.editor.daysPlaceholder', 'Days')}
                                    />
                                  </div>
                                </div>
                              </div>
                              {/* Status columns indicator */}
                              <div className="flex items-center justify-between mt-2 pt-2 border-t border-gray-100 dark:border-gray-700">
                                <Tooltip content={t('templates.editor.statusColumnsTooltip', 'Status columns: {{value}}', {
                                  value: hasTemplatePhaseStatusMappings(statusMappings, phase.template_phase_id)
                                    ? t('templates.editor.customStatusesCount', 'Custom ({{count}} statuses)', {
                                        count: statusMappings.filter(m => m.template_phase_id === phase.template_phase_id).length,
                                      })
                                    : t('templates.editor.templateDefaults', 'Template defaults'),
                                })}>
                                  <div className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
                                    <Columns3 className="w-3.5 h-3.5 shrink-0" />
                                    <span>
                                      {hasTemplatePhaseStatusMappings(statusMappings, phase.template_phase_id)
                                        ? t('templates.editor.customStatusesCount', 'Custom ({{count}} statuses)', {
                                            count: statusMappings.filter(m => m.template_phase_id === phase.template_phase_id).length,
                                          })
                                        : t('templates.editor.templateDefaults', 'Template defaults')}
                                    </span>
                                  </div>
                                </Tooltip>
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setShowStatusManager(true);
                                  }}
                                  className="text-xs text-primary hover:underline shrink-0"
                                >
                                  {t('phases.configureStatuses', 'Configure')}
                                </button>
                              </div>
                              <div className="flex justify-end gap-2 mt-3">
                                <Button
                                  id="cancel-edit-phase"
                                  variant="outline"
                                  size="sm"
                                  onClick={() => setEditingPhaseId(null)}
                                >
                                  {t('common:actions.cancel', 'Cancel')}
                                </Button>
                                <Button id="save-edit-phase" size="sm" onClick={() => handleSavePhase(phase)}>
                                  {t('common:actions.save', 'Save')}
                                </Button>
                              </div>
                            </div>
                          ) : (
                            <>
                              <div className="opacity-0 group-hover:opacity-100 transition-opacity cursor-grab pr-2">
                                <GripVertical className="w-4 h-4 text-gray-400 dark:text-gray-500" />
                              </div>
                              <div className="flex flex-col flex-1 min-w-0">
                                <div className="flex items-start justify-between gap-2">
                                  <span className="text-lg font-bold text-gray-900 dark:text-gray-100">{phase.phase_name}</span>
                                  {phaseTaskCounts[phase.template_phase_id] !== undefined && (
                                  <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-purple-100 dark:bg-purple-500/20 text-purple-700 dark:text-purple-300 shrink-0">
                                      {phaseTaskCounts[phase.template_phase_id]} {t(phaseTaskCounts[phase.template_phase_id] === 1 ? 'task' : 'tasks.title', phaseTaskCounts[phase.template_phase_id] === 1 ? 'task' : 'tasks')}
                                    </span>
                                  )}
                                </div>
                                {phase.description && (
                                  <div className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                                    {phase.description}
                                  </div>
                                )}
                                <div className="mt-1 text-xs text-gray-500 dark:text-gray-400 space-y-1">
                                  <div>
                                    {t('templates.editor.durationSummary', 'Duration: {{value}}', {
                                      value: phase.duration_days !== undefined && phase.duration_days !== null
                                        ? `${phase.duration_days}d`
                                        : t('templates.editor.notSet', 'Not set'),
                                    })}
                                  </div>
                                  <div>
                                    {t('templates.editor.startOffsetSummary', 'Start offset: {{value}}', {
                                      value: phase.start_offset_days !== undefined && phase.start_offset_days > 0
                                        ? `+${phase.start_offset_days}d`
                                        : '0d',
                                    })}
                                  </div>
                                </div>
                              </div>
                              <div className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1 shrink-0">
                                <Button
                                  id={`edit-phase-${phase.template_phase_id}`}
                                  variant="ghost"
                                  size="sm"
                                  className="p-1 h-auto w-auto"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleEditPhase(phase);
                                  }}
                                >
                                  <Pencil className="w-4 h-4" />
                                </Button>
                                <Button
                                  id={`delete-phase-${phase.template_phase_id}`}
                                  variant="ghost"
                                  size="sm"
                                  className="p-1 h-auto w-auto text-destructive hover:text-destructive hover:bg-destructive/10"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleDeletePhaseClick(phase);
                                  }}
                                >
                                  <Trash className="w-4 h-4" />
                                </Button>
                              </div>
                            </>
                          )}
                        </li>
                        );
                      })
                    )}
                    </ul>
                  </div>
                </div>
              </div>

              {/* Kanban Board - Right Side */}
              <div className={styles.kanbanArea} style={viewMode !== 'kanban' ? { flex: '1 1 auto', minHeight: 'auto' } : undefined}>
                {/* Pinnable header with phase info, search, and controls */}
                <div
                  ref={kanbanHeaderRef}
                  className={`${styles.kanbanHeader} ${isHeaderPinned ? styles.kanbanHeaderPinned : ''}`}
                >
                  {selectedPhase && (
                    <div className="flex items-center justify-between gap-4 pb-3">
                      <div className="min-w-0">
                        <h2 className="text-xl font-bold mb-1">{t('templates.detail.phasePrefix', 'Phase:')} {selectedPhase.phase_name}</h2>
                        {selectedPhase.description && (
                          <p className="text-sm text-gray-600">{selectedPhase.description}</p>
                        )}
                        <div className="text-sm text-gray-500 mt-1">
                          {selectedPhase.duration_days && t('templates.editor.phaseDurationDays', 'Duration: {{days}} days', {
                            days: selectedPhase.duration_days,
                          })}
                          {selectedPhase.start_offset_days > 0 &&
                            ` | ${t('templates.editor.phaseStartDays', 'Start: +{{days}} days', {
                              days: selectedPhase.start_offset_days,
                            })}`}
                        </div>
                      </div>
                      <div className="flex items-center gap-4 flex-shrink-0">
                        {/* Search */}
                        {showSearchBar ? (
                          <div className="flex items-center gap-1">
                            <div className="relative">
                              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
                              <input
                                type="text"
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                placeholder={t('templates.editor.searchTasksPlaceholder', 'Search tasks...')}
                                className="pl-7 pr-2 py-1 text-sm border border-gray-300 dark:border-[rgb(var(--color-border-200))] rounded-md w-48 bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary-500 focus:border-primary-500"
                                autoFocus
                              />
                            </div>
                            <Button
                              id="close-search-bar"
                              variant="ghost"
                              size="sm"
                              className="p-1 h-auto w-auto text-gray-400 hover:text-gray-600"
                              onClick={() => { setShowSearchBar(false); setSearchQuery(''); }}
                            >
                              <X className="h-4 w-4" />
                            </Button>
                          </div>
                        ) : (
                          <Tooltip content={t('templates.editor.searchTasks', 'Search tasks')}>
                            <Button
                              id="open-search-bar"
                              variant="ghost"
                              size="sm"
                              className="p-1.5 h-auto w-auto text-gray-400 hover:text-gray-600"
                              onClick={() => setShowSearchBar(true)}
                            >
                              <Search className="h-4 w-4" />
                            </Button>
                          </Tooltip>
                        )}
                        {/* Zoom */}
                        <KanbanZoomControl
                          zoomLevel={kanbanZoomLevel}
                          onZoomChange={handleZoomChange}
                        />
                        {/* Sticky status names toggle */}
                        <Tooltip content={showStickyStatusNames
                          ? t('templates.editor.hideStickyStatusNames', 'Hide sticky status names')
                          : t('templates.editor.showStickyStatusNames', 'Show sticky status names')}>
                          <Button
                            id="sticky-status-names-toggle"
                            variant="ghost"
                            size="sm"
                            className={`p-1.5 h-auto w-auto transition-colors ${
                              showStickyStatusNames
                                ? 'bg-primary-100 text-primary-600'
                                : 'text-gray-400 hover:text-gray-600'
                            }`}
                            onClick={handleToggleStickyStatusNames}
                            aria-label={showStickyStatusNames
                              ? t('templates.editor.hideStickyStatusNames', 'Hide sticky status names')
                              : t('templates.editor.showStickyStatusNames', 'Show sticky status names')}
                          >
                            <Columns3 className="h-4 w-4" />
                          </Button>
                        </Tooltip>
                        {/* Pin header toggle */}
                        <Tooltip content={isHeaderPinned
                          ? t('templates.editor.unpinHeader', 'Unpin header')
                          : t('templates.editor.pinHeader', 'Pin header to top')}>
                          <Button
                            id="pin-header-toggle"
                            variant="ghost"
                            size="sm"
                            className={`p-1.5 h-auto w-auto transition-colors ${
                              isHeaderPinned
                                ? 'bg-primary-100 text-primary-600'
                                : 'text-gray-400 hover:text-gray-600'
                            }`}
                            onClick={handleToggleHeaderPinned}
                            aria-label={isHeaderPinned
                              ? t('templates.editor.unpinHeader', 'Unpin header')
                              : t('templates.editor.pinHeader', 'Pin header to top')}
                          >
                            <Pin className={`h-4 w-4 ${isHeaderPinned ? 'fill-current' : ''}`} />
                          </Button>
                        </Tooltip>
                      </div>
                    </div>
                  )}
                  {/* Proxy scrollbar */}
                  <div className={styles.kanbanScrollbarProxy} ref={scrollbarProxyRef}>
                    <div className={styles.kanbanScrollbarProxyInner} style={{ width: boardScrollWidth }} />
                  </div>
                </div>
                {/* Sticky status strip */}
                {showStickyStatusNames && selectedPhase && (
                  <div
                    className={styles.kanbanStatusStripSticky}
                    style={{ top: isHeaderPinned ? `${kanbanHeaderHeight}px` : 0 }}
                  >
                    <div className={styles.kanbanStatusStripScroller} ref={stickyStatusStripRef}>
                      <div className={styles.kanbanStatusStripTrack}>
                        {sortedStatusMappings.map((statusMapping) => {
                          const displayName = statusMapping.status_name || statusMapping.custom_status_name || t('templates.editor.statusFallback', 'Status');
                          const statusColor = statusMapping.color || '#6B7280';
                          const { itemStyle, countStyle } = getStatusStripStyles(statusColor);
                          return (
                            <div
                              key={statusMapping.template_status_mapping_id}
                              className={styles.kanbanStatusStripItem}
                              style={{
                                ...itemStyle,
                                width: `${kanbanColumnWidth}px`,
                                minWidth: `${kanbanColumnWidth}px`,
                                maxWidth: `${kanbanColumnWidth}px`,
                              }}
                              title={displayName}
                            >
                              <span className={styles.kanbanStatusStripName}>
                                {displayName}
                              </span>
                              <Button
                                id={`sticky-add-task-${statusMapping.template_status_mapping_id}`}
                                variant="default"
                                size="sm"
                                onClick={() => handleAddTask(statusMapping.template_status_mapping_id)}
                                disabled={!selectedPhase}
                                tooltipText={t('projectPhases.addTask', 'Add Task')}
                                tooltip={true}
                                className="!w-5 !h-5 !p-0 !min-w-0 flex-shrink-0"
                              >
                                <Plus className="w-3 h-3 text-white" />
                              </Button>
                              <span className={styles.kanbanStatusStripCount} style={countStyle}>
                                {statusTaskCounts[statusMapping.template_status_mapping_id] ?? 0}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                )}
                {/* Scrollable kanban content */}
                <div
                  className={styles.kanbanContainer}
                  ref={kanbanBoardRef}
                  data-kanban-container="true"
                  style={viewMode !== 'kanban' ? { overflowY: 'visible', flex: '0 0 auto' } : undefined}
                >
                  {!selectedPhase ? (
                    <div className="flex items-center justify-center h-64 bg-gray-100 rounded-lg">
                      <div className="text-center">
                        <p className="text-xl text-gray-600">
                          {phases.length === 0
                            ? t('templates.editor.addPhaseToGetStarted', 'Add a phase to get started')
                            : t('templates.editor.selectPhaseToViewTasks', 'Select a phase to view tasks')}
                        </p>
                      </div>
                    </div>
                  ) : sortedStatusMappings.length === 0 ? (
                    <div className="text-center py-8 text-gray-500">
                      <p>{t('templates.editor.noStatusColumns', 'No status columns defined')}</p>
                      <Button
                        id="add-status-columns-empty"
                        variant="outline"
                        className="mt-4"
                        onClick={() => setShowStatusManager(true)}
                      >
                        <Settings className="h-4 w-4 mr-2" />
                        {t('templates.editor.addStatusColumns', 'Add Status Columns')}
                      </Button>
                    </div>
                  ) : (
                    <div className={styles.kanbanWrapper} style={viewMode !== 'kanban' ? { height: 'auto', minHeight: 'auto' } : undefined}>
                      <div
                        className={styles.kanbanBoard}
                        style={viewMode !== 'kanban' ? { height: 'auto', minHeight: 'auto' } : undefined}
                      >
                        {sortedStatusMappings.map((statusMapping, index) => {
                          const isFirstColumn = index === 0;
                          const statusTasks = filteredPhaseTasks.filter(
                            (task) =>
                              task.template_status_mapping_id ===
                                statusMapping.template_status_mapping_id ||
                              (isFirstColumn && !task.template_status_mapping_id)
                          );

                          const displayName =
                            statusMapping.status_name || statusMapping.custom_status_name || t('templates.editor.statusFallback', 'Status');
                          const statusColor = statusMapping.color || '#6B7280';
                          const statusIcon = getTemplateStatusIcon(statusMapping);

                          return (
                            <TemplateStatusColumn
                              key={statusMapping.template_status_mapping_id}
                              statusMapping={statusMapping}
                              displayName={displayName}
                              statusColor={statusColor}
                              tasks={statusTasks}
                              lightenColor={lightenColor}
                              statusIcon={statusIcon}
                              onTaskDragStart={handleTaskDragStart}
                              onTaskDragEnd={handleTaskDragEnd}
                              onTaskDrop={handleTaskDrop}
                              onEditTask={handleEditTask}
                              onDeleteTask={handleDeleteTaskClick}
                              onAddTask={handleAddTask}
                              onAssigneeChange={handleAssigneeChange}
                              draggedTaskId={draggedTaskId}
                              users={users}
                              priorities={priorities}
                              taskAssignments={taskAssignments}
                              taskTypes={taskTypes}
                              checklistItems={checklistItems}
                              dependencies={dependencies}
                              allTasks={tasks}
                              avatarUrls={avatarUrls}
                              teamNames={teamNames}
                              teamAvatarUrls={teamAvatarUrls}
                              columnWidth={kanbanColumnWidth}
                              cardGap={kanbanCardGap}
                              zoomLevel={kanbanZoomLevel}
                              hideHeader={showStickyStatusNames}
                            />
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

// ============================================================
// STATUS COLUMN COMPONENT
// ============================================================

interface TemplateStatusColumnProps {
  statusMapping: IProjectTemplateStatusMapping;
  displayName: string;
  statusColor: string;
  tasks: IProjectTemplateTask[];
  lightenColor: (hex: string, percent: number) => string;
  statusIcon: React.ReactNode;
  onTaskDragStart: (e: React.DragEvent, taskId: string) => void;
  onTaskDragEnd: () => void;
  onTaskDrop: (
    e: React.DragEvent,
    statusMappingId: string,
    beforeTaskId: string | null,
    afterTaskId: string | null
  ) => void;
  onEditTask: (task: IProjectTemplateTask) => void;
  onDeleteTask: (task: IProjectTemplateTask) => void;
  onAddTask: (statusMappingId: string) => void;
  onAssigneeChange: (taskId: string, assigneeId: string | null) => void;
  draggedTaskId: string | null;
  users: IUserWithRoles[];
  priorities: Array<{ priority_id: string; priority_name: string; color?: string }>;
  taskAssignments: IProjectTemplateTaskAssignment[];
  taskTypes: ITaskType[];
  checklistItems: IProjectTemplateChecklistItem[];
  dependencies: IProjectTemplateDependency[];
  allTasks: IProjectTemplateTask[];
  avatarUrls: Record<string, string | null>;
  teamNames?: Record<string, string>;
  teamAvatarUrls?: Record<string, string | null>;
  columnWidth?: number;
  cardGap?: number;
  zoomLevel?: number;
  hideHeader?: boolean;
}

function TemplateStatusColumn({
  statusMapping,
  displayName,
  statusColor,
  tasks,
  lightenColor,
  statusIcon,
  onTaskDragStart,
  onTaskDragEnd,
  onTaskDrop,
  onEditTask,
  onDeleteTask,
  onAddTask,
  onAssigneeChange,
  draggedTaskId,
  users,
  priorities,
  taskAssignments,
  taskTypes,
  checklistItems,
  dependencies,
  allTasks,
  avatarUrls,
  teamNames,
  teamAvatarUrls,
  columnWidth = 350,
  cardGap = 8,
  zoomLevel = 50,
  hideHeader = false,
}: TemplateStatusColumnProps) {
  const { t } = useTranslation('features/projects');
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';
  const [dropIndicatorPosition, setDropIndicatorPosition] = useState<number | null>(null);
  const [isDraggedOver, setIsDraggedOver] = useState(false);

  const sortedTasks = [...tasks].sort((a, b) => (a.order_key || '').localeCompare(b.order_key || ''));

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();

    if (!isDraggedOver) {
      setIsDraggedOver(true);
    }

    // Find drop position
    const rect = e.currentTarget.getBoundingClientRect();
    const y = e.clientY - rect.top;

    // Find the task closest to the cursor
    let position = sortedTasks.length;
    const taskElements = Array.from(e.currentTarget.querySelectorAll('[data-task-id]'));

    for (let i = 0; i < taskElements.length; i++) {
      const taskRect = taskElements[i].getBoundingClientRect();
      const taskMiddle = taskRect.top + taskRect.height / 2 - rect.top;
      if (y < taskMiddle) {
        position = i;
        break;
      }
    }

    setDropIndicatorPosition(position);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    // Check if we're leaving to a child element or outside the column
    const relatedTarget = e.relatedTarget as Node | null;
    if (!relatedTarget || !e.currentTarget.contains(relatedTarget)) {
      setDropIndicatorPosition(null);
      setIsDraggedOver(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();

    const currentDropPosition = dropIndicatorPosition;
    setDropIndicatorPosition(null);
    setIsDraggedOver(false);

    if (!draggedTaskId) return;

    // Calculate before/after task IDs based on position
    let beforeTaskId: string | null = null;
    let afterTaskId: string | null = null;

    if (currentDropPosition !== null) {
      beforeTaskId = sortedTasks[currentDropPosition - 1]?.template_task_id || null;
      afterTaskId = sortedTasks[currentDropPosition]?.template_task_id || null;
    }

    onTaskDrop(e, statusMapping.template_status_mapping_id, beforeTaskId, afterTaskId);
  };

  return (
    <div
      className={`${styles.kanbanColumn} rounded-lg transition-all duration-200 border-2 border-solid ${
        isDraggedOver && draggedTaskId ? 'border-purple-500 ' + styles.dragOver : ''
      }`}
      style={{
        width: `${columnWidth}px`,
        minWidth: `${columnWidth}px`,
        maxWidth: `${columnWidth}px`,
        backgroundColor: isDark ? darkenColor(statusColor, 0.75) : lightenColor(statusColor, 0.85),
        borderColor: isDraggedOver && draggedTaskId ? undefined : (isDark ? darkenColor(statusColor, 0.60) : lightenColor(statusColor, 0.70))
      }}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Status Column Header */}
      {!hideHeader && (
        <div className={`font-bold ${zoomLevel <= 30 ? 'text-xs p-2' : 'text-sm p-3'} rounded-t-lg`}>
          <div className="flex items-center justify-between gap-2">
            <div
              className={`${zoomLevel <= 30 ? 'rounded-xl border px-2 py-1.5' : 'rounded-2xl border-2 ps-3 py-3 pe-4'} flex items-center min-w-0 flex-1 shadow-sm`}
              style={{
                backgroundColor: isDark ? darkenColor(statusColor, 0.60) : lightenColor(statusColor, 0.70),
                borderColor: isDark ? darkenColor(statusColor, 0.40) : lightenColor(statusColor, 0.40),
              }}
            >
              <span className="flex-shrink-0">{statusIcon}</span>
              <span className={`${zoomLevel <= 30 ? 'ml-1.5 text-xs leading-tight' : 'ml-2'} truncate`}>
                {displayName}
              </span>
            </div>
            <div className={`${styles.statusHeader} flex-shrink-0 flex items-center`}>
              <Button
                id={`add-task-${statusMapping.template_status_mapping_id}`}
                variant="default"
                size="sm"
                onClick={() => onAddTask(statusMapping.template_status_mapping_id)}
                tooltipText={t('projectPhases.addTask', 'Add Task')}
                className={zoomLevel <= 30 ? '!w-5 !h-5 !p-0 !min-w-0' : '!w-6 !h-6 !p-0 !min-w-0'}
              >
                <Plus className={zoomLevel <= 30 ? 'w-3 h-3 text-white' : 'w-4 h-4 text-white'} />
              </Button>
              <span
                className={`${zoomLevel <= 30 ? 'text-[10px] px-1.5' : 'text-xs px-2'} font-medium py-0.5 rounded-full`}
                style={{
                  backgroundColor: isDark ? darkenColor(statusColor, 0.60) : lightenColor(statusColor, 0.70),
                  color: isDark ? lightenColor(statusColor, 0.40) : statusColor
                }}
              >
                {sortedTasks.length}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Tasks in this status */}
      <div
        className={`${styles.kanbanTasks} ${styles.taskList}`}
        data-kanban-column-tasks="true"
        style={{ gap: `${cardGap}px` }}
      >
        {sortedTasks.map((task, index) => (
          <div key={task.template_task_id}>
            {/* Drop placeholder before task */}
            <div
              className={`${styles.dropPlaceholder} ${
                dropIndicatorPosition === index && draggedTaskId ? styles.visible : ''
              }`}
            />
            <TaskCard
              task={task}
              onDragStart={onTaskDragStart}
              onDragEnd={onTaskDragEnd}
              onEdit={onEditTask}
              onDelete={onDeleteTask}
              onAssigneeChange={onAssigneeChange}
              isDragging={draggedTaskId === task.template_task_id}
              users={users}
              priorities={priorities}
              taskAssignments={taskAssignments.filter(
                (a) => a.template_task_id === task.template_task_id
              )}
              taskType={taskTypes.find((t) => t.type_key === task.task_type_key)}
              checklistItemsCount={checklistItems.filter(
                (c) => c.template_task_id === task.template_task_id
              ).length}
              taskDependencies={{
                predecessors: dependencies.filter(d => d.successor_task_id === task.template_task_id),
                successors: dependencies.filter(d => d.predecessor_task_id === task.template_task_id)
              }}
              allTasks={allTasks}
              avatarUrls={avatarUrls}
              teamNames={teamNames}
              teamAvatarUrls={teamAvatarUrls}
              zoomLevel={zoomLevel}
            />
          </div>
        ))}
        {/* Drop placeholder at end */}
        <div
          className={`${styles.dropPlaceholder} ${
            dropIndicatorPosition === sortedTasks.length && draggedTaskId ? styles.visible : ''
          }`}
        />
      </div>
    </div>
  );
}

// ============================================================
// TASK CARD COMPONENT
// ============================================================

interface TaskCardProps {
  task: IProjectTemplateTask;
  onDragStart: (e: React.DragEvent, taskId: string) => void;
  onDragEnd: () => void;
  onEdit: (task: IProjectTemplateTask) => void;
  onDelete: (task: IProjectTemplateTask) => void;
  onAssigneeChange: (taskId: string, assigneeId: string | null) => void;
  isDragging: boolean;
  users: IUserWithRoles[];
  priorities: Array<{ priority_id: string; priority_name: string; color?: string }>;
  taskAssignments: IProjectTemplateTaskAssignment[];
  taskType?: ITaskType;
  checklistItemsCount: number;
  taskDependencies?: { predecessors: IProjectTemplateDependency[]; successors: IProjectTemplateDependency[] };
  allTasks: IProjectTemplateTask[]; // To get task names for dependencies
  avatarUrls: Record<string, string | null>;
  teamNames?: Record<string, string>;
  teamAvatarUrls?: Record<string, string | null>;
  zoomLevel?: number;
}

function TaskCard({
  task,
  onDragStart,
  onDragEnd,
  onEdit,
  onDelete,
  onAssigneeChange,
  isDragging,
  users,
  priorities,
  taskAssignments,
  taskType,
  checklistItemsCount,
  taskDependencies,
  allTasks,
  avatarUrls,
  teamNames = {},
  teamAvatarUrls = {},
  zoomLevel = 50,
}: TaskCardProps) {
  const { t } = useTranslation(['features/projects', 'common']);
  const [isDescriptionExpanded, setIsDescriptionExpanded] = useState(false);
  const [isTitleExpanded, setIsTitleExpanded] = useState(false);
  const { ref: descriptionRef, isTruncated: isDescriptionTruncated } = useTruncationDetection<HTMLParagraphElement>();
  const { ref: titleRef, isTruncated: isTitleTruncated } = useTruncationDetection<HTMLDivElement>();
  const zoomScales = calculateZoomScales(zoomLevel);
  const isCompact = zoomLevel <= 30;

  const handleDragStart = (e: React.DragEvent) => {
    document.body.classList.add('dragging-task');
    onDragStart(e, task.template_task_id);
  };

  const handleDragEnd = () => {
    document.body.classList.remove('dragging-task');
    onDragEnd();
  };

  // Get task type icon and color from database, with fallback
  const taskTypeKey = task.task_type_key || 'task';
  const Icon = taskTypeIcons[taskTypeKey] || CheckSquare;
  const iconColor = taskType?.color || '#6B7280';

  // Get priority info
  const priority = priorities.find((p) => p.priority_id === task.priority_id);

  // Get additional agents count
  const additionalAgentsCount = taskAssignments.length;

  return (
    <div
      data-task-id={task.template_task_id}
      draggable
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onClick={() => onEdit(task)}
      className={`${styles.taskCard} relative bg-white dark:bg-[rgb(var(--color-card))] border border-gray-200 dark:border-[rgb(var(--color-border-200))] rounded-lg shadow-sm transition-all duration-200 flex flex-col cursor-pointer hover:shadow-md ${zoomScales.cardPadding} ${zoomScales.cardGap} ${
        isDragging ? styles.dragging : ''
      }`}
    >
      {/* Task type indicator */}
      <div className={`absolute ${zoomLevel <= 15 ? 'top-1 left-1' : 'top-2 left-2'}`} title={taskType?.type_name || taskTypeKey}>
        <Icon className={zoomLevel <= 15 ? 'w-3 h-3' : 'w-4 h-4'} style={{ color: iconColor }} />
      </div>

      {/* Action Menu Button */}
      <div className={`absolute ${zoomLevel <= 15 ? 'top-0.5 right-0.5' : 'top-1 right-1'} z-10`}>
        <DropdownMenu>
          <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
            <Button
              id={`task-actions-${task.template_task_id}`}
              variant="ghost"
              size="sm"
              className={zoomLevel <= 15 ? 'h-5 w-5 p-0' : 'h-6 w-6 p-0'}
            >
              <MoreVertical className={zoomLevel <= 15 ? 'h-3 w-3' : 'h-4 w-4'} />
              <span className="sr-only">{t('templates.editor.taskActions', 'Task Actions')}</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
            <DropdownMenuItem onSelect={() => onEdit(task)}>
              <Pencil className="mr-2 h-4 w-4" />
              <span>{t('templates.editor.editTask', 'Edit Task')}</span>
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => onDelete(task)}
              className="text-destructive focus:text-destructive focus:bg-destructive/10"
            >
              <Trash className="mr-2 h-4 w-4" />
              <span>{t('templates.editor.deleteTask', 'Delete Task')}</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Task name and priority */}
      <div className={`${isCompact ? '' : 'mb-1'} w-full px-1 ${zoomLevel <= 15 ? 'mt-3' : zoomLevel <= 30 ? 'mt-4' : 'mt-6'}`}>
        <div className="flex items-center gap-2">
          <div
            ref={titleRef}
            className={`font-semibold ${zoomScales.titleSize} flex-1 ${!isTitleExpanded ? 'line-clamp-4' : ''}`}
          >
            {task.task_name}
          </div>
          {priority && (
            <div className="flex items-center gap-1 flex-shrink-0">
              <div
                className={`${zoomLevel <= 15 ? 'w-2 h-2' : 'w-3 h-3'} rounded-full`}
                style={{ backgroundColor: priority.color || '#6B7280' }}
                title={t('templates.editor.priorityLevel', 'Priority level: {{priority}}', {
                  priority: priority.priority_name,
                })}
              />
              {zoomLevel > 15 && (
                <span className={`${zoomScales.metaSize} text-gray-600 dark:text-gray-400`}>
                  {priority.priority_name}
                </span>
              )}
            </div>
          )}
        </div>
        {(isTitleTruncated || isTitleExpanded) && (
          <Button
            id={`toggle-title-${task.template_task_id}`}
            variant="ghost"
            size="sm"
            className={`${zoomScales.metaSize} text-purple-600 hover:text-purple-700 font-medium p-0 h-auto w-auto ${isCompact ? '' : 'mt-1'}`}
            onClick={(e) => {
              e.stopPropagation();
              setIsTitleExpanded(!isTitleExpanded);
            }}
          >
            {isTitleExpanded
              ? t('templates.editor.seeLess', 'See less')
              : t('templates.editor.seeMore', 'See more')}
          </Button>
        )}
      </div>

      {/* Description */}
      {task.description && zoomScales.showDescription && (
        <div className={isCompact ? 'mb-0.5 px-1' : 'mb-2 px-1'}>
          <p
            ref={descriptionRef}
            className={`${zoomScales.descSize} text-gray-600 dark:text-gray-400 ${!isDescriptionExpanded ? 'line-clamp-2' : ''}`}
          >
            {task.description}
          </p>
          {(isDescriptionTruncated || isDescriptionExpanded) && (
            <Button
              id={`toggle-desc-${task.template_task_id}`}
              variant="ghost"
              size="sm"
              className={`${zoomScales.metaSize} text-purple-600 hover:text-purple-700 font-medium p-0 h-auto w-auto ${isCompact ? '' : 'mt-1'}`}
              onClick={(e) => {
                e.stopPropagation();
                setIsDescriptionExpanded(!isDescriptionExpanded);
              }}
            >
              {isDescriptionExpanded
                ? t('templates.editor.seeLess', 'See less')
                : t('templates.editor.seeMore', 'See more')}
            </Button>
          )}
        </div>
      )}

      {/* Assignee picker */}
      <div className={`flex items-center ${zoomLevel <= 30 ? 'gap-1' : 'gap-2'} px-1`} onClick={(e) => e.stopPropagation()}>
        <UserPicker
          value={task.assigned_to || ''}
          onValueChange={(newAssigneeId: string) =>
            onAssigneeChange(task.template_task_id, newAssigneeId || null)
          }
          size={zoomLevel <= 30 ? 'xs' : 'sm'}
          users={users}
          getUserAvatarUrlsBatch={getUserAvatarUrlsBatchAction}
        />
        {task.assigned_team_id && teamNames[task.assigned_team_id] && (
          <Tooltip content={teamNames[task.assigned_team_id]}>
            <span className="inline-flex items-center cursor-help">
              <TeamAvatar
                teamId={task.assigned_team_id}
                teamName={teamNames[task.assigned_team_id]}
                avatarUrl={teamAvatarUrls[task.assigned_team_id] ?? null}
                size="xs"
              />
            </span>
          </Tooltip>
        )}
        {additionalAgentsCount > 0 && (
          <Tooltip
            content={
              <div className="text-xs space-y-1.5">
                <div className="font-medium text-gray-300 mb-1">{t('templates.editor.additionalAgents', 'Additional Agents:')}</div>
                {taskAssignments.map((assignment, i) => {
                  const assignmentUser = users.find(u => u.user_id === assignment.user_id);
                  const userName = assignmentUser ? `${assignmentUser.first_name} ${assignmentUser.last_name}` : t('templates.editor.unknownUser', 'Unknown');
                  return (
                    <div key={i} className="flex items-center gap-2">
                      <UserAvatar
                        userId={assignment.user_id}
                        userName={userName}
                        avatarUrl={avatarUrls[assignment.user_id] ?? null}
                        size="xs"
                      />
                      <span>{userName}</span>
                    </div>
                  );
                })}
              </div>
            }
          >
            <span
              className={`font-medium cursor-help rounded ${zoomLevel <= 30 ? 'text-[10px] px-1 py-0.5' : 'text-xs px-1.5 py-0.5'}`}
              style={{
                color: 'rgb(var(--color-primary-500))',
                backgroundColor: 'rgb(var(--color-primary-50))'
              }}
            >
              +{additionalAgentsCount}
            </span>
          </Tooltip>
        )}
      </div>

      {/* Bottom row: estimated hours, duration, checklist, dependencies */}
      <div className={`flex items-center justify-between px-1 ${zoomScales.metaSize} text-gray-500 dark:text-gray-400 ${isCompact ? 'mt-0.5' : 'mt-1'}`}>
        <div className="flex items-center gap-2">
          {task.estimated_hours && (
            <span className="flex items-center gap-1 bg-gray-50 dark:bg-[rgb(var(--color-border-100))] px-2 py-1 rounded">
              <Clock className="w-3 h-3" />
              {Number(task.estimated_hours) / 60}h
            </span>
          )}
          {task.duration_days && (
            <span className="bg-gray-50 dark:bg-[rgb(var(--color-border-100))] px-2 py-1 rounded">{task.duration_days}d</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {checklistItemsCount > 0 && (
            <span
              className="flex items-center gap-1 bg-gray-50 dark:bg-[rgb(var(--color-border-100))] px-2 py-1 rounded"
              title={t('templates.editor.checklistCountTitle', '{{count}} checklist item', {
                count: checklistItemsCount,
              })}
            >
              <CheckSquare className="w-3 h-3" />
              {checklistItemsCount}
            </span>
          )}
          {/* Dependencies indicator */}
          {taskDependencies && (taskDependencies.predecessors.length > 0 || taskDependencies.successors.length > 0) && (
            <Tooltip
              content={
                <div className="text-xs space-y-2 min-w-[220px]">
                  {taskDependencies.predecessors.length > 0 && (
                    <div>
                      <div className="font-medium text-gray-300 mb-1">{t('templates.editor.dependsOn', 'Depends on:')}</div>
                      {taskDependencies.predecessors.map((d, i) => {
                        const isBlocking = d.dependency_type === 'blocks' || d.dependency_type === 'blocked_by';
                        const predecessorTask = allTasks.find(t => t.template_task_id === d.predecessor_task_id);
                        return (
                          <div key={i} className="flex items-center gap-1.5 ml-2">
                            <span className={isBlocking ? 'text-orange-400' : 'text-blue-400'}>
                              {isBlocking ? <Ban className="h-3 w-3" /> : <GitBranch className="h-3 w-3" />}
                            </span>
                            <span>{predecessorTask?.task_name || t('templates.editor.unknownTask', 'Unknown task')}</span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                  {taskDependencies.successors.length > 0 && (
                    <div>
                      <div className="font-medium text-gray-300 mb-1">{t('templates.editor.blocks', 'Blocks:')}</div>
                      {taskDependencies.successors.map((d, i) => {
                        const isBlocking = d.dependency_type === 'blocks' || d.dependency_type === 'blocked_by';
                        const successorTask = allTasks.find(t => t.template_task_id === d.successor_task_id);
                        return (
                          <div key={i} className="flex items-center gap-1.5 ml-2">
                            <span className={isBlocking ? 'text-red-400' : 'text-blue-400'}>
                              {isBlocking ? <Ban className="h-3 w-3" /> : <GitBranch className="h-3 w-3" />}
                            </span>
                            <span>{successorTask?.task_name || t('templates.editor.unknownTask', 'Unknown task')}</span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              }
            >
              <span className={`flex items-center gap-1 px-1.5 py-0.5 rounded ${
                taskDependencies.predecessors.some(d => d.dependency_type === 'blocks' || d.dependency_type === 'blocked_by') ||
                taskDependencies.successors.some(d => d.dependency_type === 'blocks' || d.dependency_type === 'blocked_by')
                  ? 'bg-destructive/10 text-destructive'
                  : 'bg-primary/10 text-primary'
              }`}>
                {taskDependencies.predecessors.some(d => d.dependency_type === 'blocks' || d.dependency_type === 'blocked_by') ||
                 taskDependencies.successors.some(d => d.dependency_type === 'blocks' || d.dependency_type === 'blocked_by')
                  ? <Ban className="w-3 h-3" />
                  : <GitBranch className="w-3 h-3" />
                }
                <span>{taskDependencies.predecessors.length + taskDependencies.successors.length}</span>
              </span>
            </Tooltip>
          )}
        </div>
      </div>
    </div>
  );
}
