'use client'

import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { parse } from 'date-fns';
import Link from 'next/link';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import { ColumnDefinition } from '@alga-psa/types';
import { IProject, IClient, DeletionValidationResult } from '@alga-psa/types';
import { ITag } from '@alga-psa/types';
import { Button } from '@alga-psa/ui/components/Button';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import ProjectQuickAdd from './ProjectQuickAdd';
import { deleteProject } from '../actions/projectActions';
import { findUserById } from '@alga-psa/user-composition/actions';
import { findTagsByEntityIds, findAllTagsByType } from '@alga-psa/tags/actions';
import { TagFilter } from '@alga-psa/ui/components';
import { TagManager } from '@alga-psa/tags/components';
import { useTagPermissions } from '@alga-psa/tags/hooks';
import { DeleteEntityDialog } from '@alga-psa/ui';
import { toast } from 'react-hot-toast';
import { Search, MoreVertical, Pen, Trash2, XCircle, ExternalLink, FileText } from 'lucide-react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { useDrawer, useClientDrawer } from "@alga-psa/ui";
import ProjectDetailsEdit from './ProjectDetailsEdit';
import { Input } from '@alga-psa/ui/components/Input';
import { ClientPicker } from '@alga-psa/ui/components/ClientPicker';
import { ContactPicker } from '@alga-psa/ui/components/ContactPicker';
import UserPicker from '@alga-psa/ui/components/UserPicker';
import { DatePicker } from '@alga-psa/ui/components/DatePicker';
import { handleError, isActionPermissionError } from '@alga-psa/ui/lib/errorHandling';
import { preCheckDeletion } from '@alga-psa/auth/lib/preCheckDeletion';
import { DeadlineFilter, DeadlineFilterValue } from './DeadlineFilter';
import { IContact } from '@alga-psa/types';
import { IUser } from '@shared/interfaces/user.interfaces';
import { getAllUsersBasic, getUserAvatarUrlsBatchAction } from '@alga-psa/user-composition/actions';
import Drawer from '@alga-psa/ui/components/Drawer';
import { ApplyTemplateDialog } from './project-templates/ApplyTemplateDialog';
import { useClientIntegration } from '../context/ClientIntegrationContext';
import { useTranslation } from 'react-i18next';

export interface ProjectListFilters {
  searchQuery?: string;
  status?: 'all' | 'active' | 'inactive';
  clientId?: string;
  contactId?: string;
  managerId?: string;
  tags?: string[];
  deadlineType?: 'before' | 'after' | 'on' | 'between';
  deadlineDate?: string; // ISO date string
  deadlineEndDate?: string; // ISO date string for 'between'
  page?: number;
  pageSize?: number;
}

function buildURLFromFilters(filters: ProjectListFilters): string {
  const params = new URLSearchParams();

  if (filters.searchQuery) params.set('searchQuery', filters.searchQuery);
  if (filters.status && filters.status !== 'active') params.set('status', filters.status);
  if (filters.clientId) params.set('clientId', filters.clientId);
  if (filters.contactId) params.set('contactId', filters.contactId);
  if (filters.managerId) params.set('managerId', filters.managerId);
  if (filters.tags && filters.tags.length > 0) {
    const encodedTags = filters.tags.map(tag => encodeURIComponent(String(tag)));
    params.set('tags', encodedTags.join(','));
  }
  if (filters.deadlineType) {
    params.set('deadlineType', filters.deadlineType);
    if (filters.deadlineDate) params.set('deadlineDate', filters.deadlineDate);
    if (filters.deadlineEndDate) params.set('deadlineEndDate', filters.deadlineEndDate);
  }
  if (filters.page && filters.page !== 1) params.set('page', String(filters.page));
  if (filters.pageSize && filters.pageSize !== 10) params.set('pageSize', String(filters.pageSize));

  return params.toString() ? `/msp/projects?${params.toString()}` : '/msp/projects';
}

function parseFiltersFromSearch(search: string): ProjectListFilters {
  const params = new URLSearchParams(search);
  const filters: ProjectListFilters = {};

  const searchQuery = params.get('searchQuery');
  if (searchQuery) filters.searchQuery = searchQuery;

  const status = params.get('status');
  if (status === 'all' || status === 'active' || status === 'inactive') {
    filters.status = status;
  }

  const clientId = params.get('clientId');
  if (clientId) filters.clientId = clientId;

  const contactId = params.get('contactId');
  if (contactId) filters.contactId = contactId;

  const managerId = params.get('managerId');
  if (managerId) filters.managerId = managerId;

  const tagsRaw = params.get('tags');
  if (tagsRaw) {
    const decoded = tagsRaw
      .split(',')
      .map(tag => decodeURIComponent(tag).trim())
      .filter(tag => tag.length > 0);
    if (decoded.length > 0) filters.tags = decoded;
  }

  const deadlineType = params.get('deadlineType');
  if (deadlineType === 'before' || deadlineType === 'after' || deadlineType === 'on' || deadlineType === 'between') {
    filters.deadlineType = deadlineType;
    const deadlineDate = params.get('deadlineDate');
    if (deadlineDate) filters.deadlineDate = deadlineDate;
    const deadlineEndDate = params.get('deadlineEndDate');
    if (deadlineEndDate) filters.deadlineEndDate = deadlineEndDate;
  }

  const page = Number.parseInt(params.get('page') || '', 10);
  if (Number.isFinite(page) && page > 0) filters.page = page;

  const pageSize = Number.parseInt(params.get('pageSize') || '', 10);
  if (Number.isFinite(pageSize) && pageSize > 0) filters.pageSize = pageSize;

  return filters;
}

interface ProjectsProps {
  initialProjects: IProject[];
  clients: IClient[];
  initialFilters?: Partial<ProjectListFilters>;
  initialProjectTags?: Record<string, ITag[]>;
  initialAllUniqueTags?: ITag[];
}

export const DEFAULT_PROJECT_FILTERS: ProjectListFilters = {
  status: 'active',
  page: 1,
  pageSize: 10,
};

export default function Projects({ initialProjects, clients, initialFilters, initialProjectTags, initialAllUniqueTags }: ProjectsProps) {
  const { t } = useTranslation(['features/projects', 'common']);
  const projectListT = useCallback((key: string, fallback: string, options?: Record<string, unknown>) =>
    t(`projectList.${key}`, { defaultValue: fallback, ...(options ?? {}) }), [t]);
  const { getAllContacts, getContactByContactNameId, renderQuickAddContact, renderClientDetails } = useClientIntegration();
  // Pre-fetch tag permissions to prevent individual API calls
  useTagPermissions(['project']);

  // Unified filter state
  const [activeFilters, setActiveFilters] = useState<ProjectListFilters>(() => ({
    ...DEFAULT_PROJECT_FILTERS,
    ...initialFilters,
  }));
  const activeFiltersRef = useRef(activeFilters);
  activeFiltersRef.current = activeFilters;

  const [projects, setProjects] = useState<IProject[]>(initialProjects);

  // Sync state when initialProjects changes (e.g., from router.refresh())
  useEffect(() => {
    setProjects(initialProjects);
  }, [initialProjects]);

  const [showQuickAdd, setShowQuickAdd] = useState(false);
  const [showApplyTemplate, setShowApplyTemplate] = useState(false);
  const [projectToDelete, setProjectToDelete] = useState<IProject | null>(null);
  const [deleteValidation, setDeleteValidation] = useState<DeletionValidationResult | null>(null);
  const [isDeleteValidating, setIsDeleteValidating] = useState(false);
  const [isDeleteProcessing, setIsDeleteProcessing] = useState(false);
  const { openDrawer, closeDrawer } = useDrawer();
  const clientDrawer = useClientDrawer();

  // Tag-related state. Seeded from server-fetched tags so URL-based tag filters
  // work on the very first render (bookmarked/pasted URLs).
  const projectTagsRef = useRef<Record<string, ITag[]>>(initialProjectTags ?? {});
  const [allUniqueTags, setAllUniqueTags] = useState<ITag[]>(initialAllUniqueTags ?? []);
  const [tagsVersion, setTagsVersion] = useState(0); // Used to force re-render when tags are fetched

  // Picker-internal UI state (not URL-persisted)
  const [isQuickAddContactOpen, setIsQuickAddContactOpen] = useState(false);
  const [clientFilterState, setClientFilterState] = useState<'all' | 'active' | 'inactive'>('all');
  const [clientClientTypeFilter, setClientClientTypeFilter] = useState<'all' | 'company' | 'individual'>('all');

  // Data for pickers
  const [contacts, setContacts] = useState<IContact[]>([]);
  const [users, setUsers] = useState<IUser[]>([]);

  // Quick View state
  const [quickViewClient, setQuickViewClient] = useState<IClient | null>(null);
  const [isQuickViewOpen, setIsQuickViewOpen] = useState(false);

  // Ref to track last applied URL search string (prevents duplicate updates)
  const lastAppliedSearchRef = useRef<string>('');
  const isSyncingFromHistoryRef = useRef(false);
  const filterUpdateTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Derive DeadlineFilterValue from activeFilters for the DeadlineFilter component
  const deadlineFilterValue = useMemo((): DeadlineFilterValue | undefined => {
    if (!activeFilters.deadlineType) return undefined;
    const result: DeadlineFilterValue = { type: activeFilters.deadlineType };
    if (activeFilters.deadlineDate) result.date = new Date(activeFilters.deadlineDate);
    if (activeFilters.deadlineEndDate) result.endDate = new Date(activeFilters.deadlineEndDate);
    return result;
  }, [activeFilters.deadlineType, activeFilters.deadlineDate, activeFilters.deadlineEndDate]);

  // Sync filter state to URL
  const updateURLWithFilters = useCallback((filters: ProjectListFilters) => {
    const newURL = buildURLFromFilters(filters);
    const newSearch = newURL.includes('?') ? newURL.slice(newURL.indexOf('?')) : '';
    window.history.replaceState(null, '', newURL);
    lastAppliedSearchRef.current = newSearch;
  }, []);

  // Unified filter change handler — accepts partial updates, merges with current state
  const handleFilterChange = useCallback((update: Partial<ProjectListFilters>) => {
    // Skip no-op updates
    const updateKeys = Object.keys(update) as (keyof ProjectListFilters)[];
    const hasRealChange = updateKeys.some((key) => {
      const newVal = update[key];
      const oldVal = activeFiltersRef.current[key];
      if (Array.isArray(newVal) && Array.isArray(oldVal)) {
        return newVal.length !== oldVal.length || newVal.some((v, i) => v !== (oldVal as unknown[])[i]);
      }
      return newVal !== oldVal;
    });
    if (!hasRealChange) return;

    // Reset page to 1 when any non-pagination filter changes
    const isPaginationOnly = updateKeys.every(k => k === 'page' || k === 'pageSize');

    const mergedFilters: ProjectListFilters = {
      ...activeFiltersRef.current,
      ...update,
      ...(isPaginationOnly ? {} : { page: 1 }),
    };

    setActiveFilters(mergedFilters);
    activeFiltersRef.current = mergedFilters;

    // Debounce URL update (handles rapid typing in search)
    if (filterUpdateTimeoutRef.current) {
      clearTimeout(filterUpdateTimeoutRef.current);
    }
    filterUpdateTimeoutRef.current = setTimeout(() => {
      filterUpdateTimeoutRef.current = null;
      updateURLWithFilters(mergedFilters);
    }, 300);
  }, [updateURLWithFilters]);

  // Sync from URL on browser back/forward navigation
  const syncFromUrl = useCallback((search: string) => {
    const normalizedSearch = search || '';
    if (normalizedSearch === lastAppliedSearchRef.current || isSyncingFromHistoryRef.current) {
      return;
    }

    isSyncingFromHistoryRef.current = true;
    try {
      const parsed = parseFiltersFromSearch(normalizedSearch);
      const restoredFilters: ProjectListFilters = {
        ...DEFAULT_PROJECT_FILTERS,
        ...parsed,
      };
      setActiveFilters(restoredFilters);
      activeFiltersRef.current = restoredFilters;
      lastAppliedSearchRef.current = normalizedSearch;
    } finally {
      isSyncingFromHistoryRef.current = false;
    }
  }, []);

  // Listen for popstate (back/forward) and pageshow (bfcache restore) events
  useEffect(() => {
    if (typeof window === 'undefined') return;

    // On mount, sync from URL if it has search params.
    // This handles the case where Next.js restores a cached page on back navigation
    // but the URL still has filter params from replaceState.
    const currentSearch = window.location.search;
    if (currentSearch) {
      syncFromUrl(currentSearch);
    } else {
      lastAppliedSearchRef.current = currentSearch;
    }

    const handlePopState = () => {
      syncFromUrl(window.location.search);
    };
    const handlePageShow = (event: PageTransitionEvent) => {
      if (event.persisted) {
        lastAppliedSearchRef.current = '__pageshow__';
        syncFromUrl(window.location.search);
      }
    };

    window.addEventListener('popstate', handlePopState);
    window.addEventListener('pageshow', handlePageShow);
    return () => {
      window.removeEventListener('popstate', handlePopState);
      window.removeEventListener('pageshow', handlePageShow);
      if (filterUpdateTimeoutRef.current) {
        clearTimeout(filterUpdateTimeoutRef.current);
      }
    };
  }, [syncFromUrl]);

  const handleTagsChange = (projectId: string, tags: ITag[]) => {
    projectTagsRef.current[projectId] = tags;
    
    // Update unique tags list if needed
    setAllUniqueTags(current => {
      const currentTagTexts = new Set(current.map(t => t.tag_text));
      const newTags = tags.filter(tag => !currentTagTexts.has(tag.tag_text));
      return [...current, ...newTags];
    });
  };

  // Fetch project-specific tags when projects change
  useEffect(() => {
    const fetchTags = async () => {
      if (projects.length === 0) return;
      
      try {
        const projectIds = projects.map(project => project.project_id).filter((id): id is string => id !== undefined);
        
        // Only fetch project-specific tags, not all tags again
        const projectTags = await findTagsByEntityIds(projectIds, 'project');

        const newProjectTags: Record<string, ITag[]> = {};
        projectTags.forEach(tag => {
          if (!newProjectTags[tag.tagged_id]) {
            newProjectTags[tag.tagged_id] = [];
          }
          newProjectTags[tag.tagged_id].push(tag);
        });

        projectTagsRef.current = newProjectTags;
        // Force re-render to show fetched tags
        setTagsVersion(v => v + 1);
      } catch (error) {
        console.error('Error fetching tags:', error);
      }
    };
    fetchTags();
  }, [projects]);

  // Fetch all unique tags only once on mount
  useEffect(() => {
    const fetchAllTags = async () => {
      try {
        const allTags = await findAllTagsByType('project');
        setAllUniqueTags(allTags);
      } catch (error) {
        console.error('Error fetching all tags:', error);
      }
    };
    fetchAllTags();
  }, []);

  // Fetch contacts and users
  useEffect(() => {
    const fetchData = async () => {
      try {
        const [contactsData, usersData] = await Promise.all([
          getAllContacts('all'),
          getAllUsersBasic(true)
        ]);
        setContacts(contactsData || []);
        setUsers(usersData || []);
      } catch (error) {
        console.error('Error fetching contacts and users:', error);
      }
    };
    fetchData();
  }, []);

  const filteredProjects = useMemo(() => {
    const { searchQuery, status, tags, clientId, contactId, managerId } = activeFilters;
    const search = (searchQuery || '').toLowerCase();

    let filtered = projects.filter(project =>
      (project.project_name.toLowerCase().includes(search) ||
       project.project_number?.toLowerCase().includes(search)) &&
      (status === 'all' ||
       (status === 'active' && !project.is_inactive) ||
       (status === 'inactive' && project.is_inactive))
    );

    // Apply tag filter if tags are selected
    if (tags && tags.length > 0) {
      filtered = filtered.filter(project => {
        const projectTags = projectTagsRef.current[project.project_id || ''] || [];
        const projectTagTexts = projectTags.map(tag => tag.tag_text);
        return tags.some(selectedTag => projectTagTexts.includes(selectedTag));
      });
    }

    // Apply client filter
    if (clientId) {
      filtered = filtered.filter(project => project.client_id === clientId);
    }

    // Apply contact filter
    if (contactId) {
      filtered = filtered.filter(project => project.contact_name_id === contactId);
    }

    // Apply project manager filter
    if (managerId) {
      filtered = filtered.filter(project => project.assigned_to === managerId);
    }

    // Apply deadline filter
    if (deadlineFilterValue?.date) {
      filtered = filtered.filter(project => {
        if (!project.end_date) return false;
        const projectDeadline = new Date(project.end_date);
        const filterDate = deadlineFilterValue.date!;

        switch (deadlineFilterValue.type) {
          case 'before':
            return projectDeadline < filterDate;
          case 'after':
            return projectDeadline > filterDate;
          case 'on':
            const projectDay = projectDeadline.toISOString().split('T')[0];
            const filterDay = filterDate.toISOString().split('T')[0];
            return projectDay === filterDay;
          case 'between':
            if (!deadlineFilterValue.endDate) return false;
            return projectDeadline >= filterDate && projectDeadline <= deadlineFilterValue.endDate;
          default:
            return true;
        }
      });
    }

    // Sort projects with case-insensitive alphabetical sorting
    filtered.sort((a, b) => {
      return a.project_name.toLowerCase().localeCompare(b.project_name.toLowerCase());
    });

    return filtered;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- tagsVersion tracks projectTagsRef mutations
  }, [projects, activeFilters, deadlineFilterValue, tagsVersion]);

  const handleEditProject = (project: IProject) => {
    openDrawer(
      <ProjectDetailsEdit
        initialProject={project}
        clients={clients}
        onSave={(updatedProject) => {
          setProjects(prevProjects =>
            prevProjects.map((p): IProject =>
              p.project_id === updatedProject.project_id ? updatedProject : p
            )
          );
          closeDrawer();
        }}
        onCancel={() => {
          closeDrawer();
        }}
      />
    );
  };

  const resetDeleteState = () => {
    setProjectToDelete(null);
    setDeleteValidation(null);
    setIsDeleteValidating(false);
    setIsDeleteProcessing(false);
  };

  const runDeleteValidation = useCallback(async (projectId: string) => {
    setIsDeleteValidating(true);
    try {
      const result = await preCheckDeletion('project', projectId);
      setDeleteValidation(result);
    } catch (error) {
      console.error('Failed to validate project deletion:', error);
      setDeleteValidation({
        canDelete: false,
        code: 'VALIDATION_FAILED',
        message: projectListT('deleteValidationFailed', 'Failed to validate deletion. Please try again.'),
        dependencies: [],
        alternatives: []
      });
    } finally {
      setIsDeleteValidating(false);
    }
  }, [projectListT]);

  const handleDelete = async (project: IProject) => {
    setProjectToDelete(project);
    void runDeleteValidation(project.project_id);
  };

  const confirmDelete = async () => {
    if (!projectToDelete) return;

    try {
      setIsDeleteProcessing(true);
      const result = await deleteProject(projectToDelete.project_id);

      if (isActionPermissionError(result)) {
        handleError(result.permissionError);
        return;
      }

      if (!result.success) {
        setDeleteValidation(result);
        return;
      }

      setProjects(projects.filter(p => p.project_id !== projectToDelete.project_id));
      toast.success(projectListT('deletedSuccess', 'Project deleted successfully'));
      resetDeleteState();
    } catch (error) {
      console.error('Error deleting project:', error);
      setDeleteValidation({
        canDelete: false,
        code: 'VALIDATION_FAILED',
        message: projectListT('deleteFailed', 'Failed to delete project.'),
        dependencies: [],
        alternatives: []
      });
    } finally {
      setIsDeleteProcessing(false);
    }
  };

  const onQuickViewClient = (clientId: string) => {
    if (clientDrawer) {
      clientDrawer.openClientDrawer(clientId);
      return;
    }
    const client = clients.find(c => c.client_id === clientId);
    if (client) {
      setQuickViewClient(client);
      setIsQuickViewOpen(true);
    }
  };

  const formatDisplayDate = (value: unknown): string => {
    if (value == null) return projectListT('notAvailable', 'N/A');

    const resolveDatePart = (): string | null => {
      if (typeof value === 'string') {
        const match = value.match(/^(\d{4}-\d{2}-\d{2})/);
        if (match) return match[1];

        const date = new Date(value);
        return isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
      }

      const date = value instanceof Date ? value : new Date(value as any);
      return isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
    };

    const datePart = resolveDatePart();
    if (!datePart) return projectListT('notAvailable', 'N/A');

    // Use a date-only value to keep SSR and client rendering consistent regardless of timezone.
    const date = parse(datePart, 'yyyy-MM-dd', new Date());
    return isNaN(date.getTime()) ? projectListT('notAvailable', 'N/A') : date.toLocaleDateString();
  };

  const columns: ColumnDefinition<IProject>[] = [
    {
      title: projectListT('columns.number', 'Number'),
      dataIndex: 'project_number',
      width: '8%',
      render: (text: string, record: IProject) => {
        return (
          <Link href={`/msp/projects/${record.project_id}`} className="text-blue-600 hover:text-blue-800">
            {text}
          </Link>
        );
      },
    },
    {
      title: projectListT('columns.projectName', 'Project Name'),
      dataIndex: 'project_name',
      width: '15%',
      render: (text: string, record: IProject) => (
        <Link href={`/msp/projects/${record.project_id}`} className="text-blue-600 hover:text-blue-800 block whitespace-normal break-words">
          {text}
        </Link>
      ),
    },
    {
      title: projectListT('columns.client', 'Client'),
      dataIndex: 'client_id',
      width: '12%',
      render: (value, record) => {
        const client = clients.find(c => c.client_id === value);
        if (!client) return projectListT('noClient', 'No Client');

        return (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onQuickViewClient(value);
            }}
            className="text-blue-500 hover:underline text-left whitespace-normal break-words"
          >
            {client.client_name}
          </button>
        );
      }
    },
    {
      title: projectListT('columns.contact', 'Contact'),
      dataIndex: 'contact_name',
      width: '10%',
      render: (name: string | null) => name || projectListT('noContact', 'No Contact'),
    },
    {
      title: projectListT('columns.status', 'Status'),
      dataIndex: 'status_name',
      width: '8%',
      render: (_: string | null, record: IProject) => (
        <div className="inline-flex items-center px-2.5 py-0.5 text-sm text-gray-800">
          {record.status_name || projectListT('statusUnknown', 'Unknown')}
        </div>
      ),
    },
    {
      title: projectListT('columns.deadline', 'Deadline'),
      dataIndex: 'end_date',
      width: '8%',
      render: (value: unknown) => formatDisplayDate(value),
    },
    {
      title: projectListT('columns.created', 'Created'),
      dataIndex: 'created_at',
      width: '8%',
      render: (value: unknown) => formatDisplayDate(value),
    },
    {
      title: projectListT('columns.projectManager', 'Project Manager'),
      dataIndex: 'assigned_to',
      width: '12%',
      render: (userId: string | null, record: IProject) => {
        if (!userId) return projectListT('unassigned', 'Unassigned');
        const user = record.assigned_user;
        return user ? `${user.first_name} ${user.last_name}` : projectListT('unassigned', 'Unassigned');
      }
    },
    {
      title: projectListT('columns.tags', 'Tags'),
      dataIndex: 'tags',
      width: '14%',
      render: (value: string, record: IProject) => {
        if (!record.project_id) return null;
        
        return (
          <TagManager
            entityId={record.project_id}
            entityType="project"
            initialTags={projectTagsRef.current[record.project_id] || []}
            onTagsChange={(tags) => handleTagsChange(record.project_id!, tags)}
          />
        );
      },
    },
    {
      title: projectListT('columns.actions', 'Actions'),
      dataIndex: 'actions',
      width: '5%',
      render: (_: unknown, record: IProject) => (
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <Button
              id={`project-actions-${record.project_id}`}
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0"
              onClick={(e) => e.stopPropagation()}
            >
              <span className="sr-only">{projectListT('openMenu', 'Open menu')}</span>
              <MoreVertical className="h-4 w-4" />
            </Button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Content className="bg-white rounded-md shadow-lg p-1 z-50">
            <DropdownMenu.Item
              className="px-2 py-1 text-sm cursor-pointer hover:bg-gray-100 flex items-center"
              onSelect={(e) => {
                e.stopPropagation();
                handleEditProject(record);
              }}
            >
              <Pen size={14} className="mr-2" />
              {t('common:actions.edit', 'Edit')}
            </DropdownMenu.Item>
            <DropdownMenu.Item
              className="px-2 py-1 text-sm cursor-pointer hover:bg-gray-100 flex items-center text-destructive"
              onSelect={(e) => {
                e.stopPropagation();
                handleDelete(record);
              }}
            >
              <Trash2 size={14} className="mr-2" />
              {t('common:actions.delete', 'Delete')}
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Root>
      ),
    },
  ];

  const handleProjectAdded = async (newProject: IProject) => {
    try {
      // Store tags for the new project if provided
      if (newProject.project_id && newProject.tags && newProject.tags.length > 0) {
        projectTagsRef.current[newProject.project_id] = newProject.tags;

        // Update unique tags list with any new tags
        setAllUniqueTags(prevTags => {
          const currentTagTexts = new Set(prevTags.map(t => t.tag_text));
          const newUniqueTags = newProject.tags!.filter(tag => !currentTagTexts.has(tag.tag_text));
          if (newUniqueTags.length > 0) {
            return [...prevTags, ...newUniqueTags];
          }
          return prevTags;
        });
      }

      // Create a new object with additional properties
      const projectWithDetails: IProject = {
        ...newProject,
        contact_name: newProject.contact_name || null,
        assigned_user: null
      };

      // Fetch contact details if contact_name_id exists
      if (newProject.contact_name_id) {
        const contact = await getContactByContactNameId(newProject.contact_name_id);
        projectWithDetails.contact_name = contact?.full_name || null;
      }

      // Fetch user details if assigned_to exists
      if (newProject.assigned_to) {
        const user = await findUserById(newProject.assigned_to);
        projectWithDetails.assigned_user = user || null;
      }

      // Update state with the complete project data
      setProjects(prevProjects => [...prevProjects, projectWithDetails]);
    } catch (error) {
      console.error('Error fetching additional project details:', error);
      // Add project with basic details if there's an error
      setProjects(prevProjects => [...prevProjects, newProject]);
    }
  };

  const statusOptions = useMemo(() => [
    { value: 'all', label: projectListT('statusOptions.all', 'All projects') },
    { value: 'active', label: projectListT('statusOptions.active', 'Active projects') },
    { value: 'inactive', label: projectListT('statusOptions.inactive', 'Inactive projects') }
  ], [projectListT]);

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">{t('title', 'Projects')}</h1>
        <div className="flex items-center gap-3">
          <Button
            id='create-from-template-button'
            onClick={() => setShowApplyTemplate(true)}
            variant="outline"
          >
            <FileText className="h-4 w-4 mr-2" />
            {projectListT('createFromTemplate', 'Create from Template')}
          </Button>
          <Button id='add-project-button' onClick={() => setShowQuickAdd(true)}>
            {projectListT('addProject', 'Add Project')}
          </Button>
        </div>
      </div>

      {/* Filter section */}
      <div className="mb-6 flex items-center gap-2">
          {/* Search bar */}
          <div className="relative p-0.5 shrink-0">
            <Input
              type="text"
              placeholder={projectListT('searchPlaceholder', 'Search projects')}
              className="pl-10 pr-4 py-2 w-64"
              value={activeFilters.searchQuery || ''}
              onChange={(e) => handleFilterChange({ searchQuery: e.target.value || undefined })}
            />
            <Search size={20} className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" />
          </div>

          {/* Status filter */}
          <div className="relative z-10 shrink-0">
            <CustomSelect
              options={statusOptions}
              value={activeFilters.status || 'active'}
              onValueChange={(value) => handleFilterChange({ status: value as 'all' | 'active' | 'inactive' })}
              placeholder={projectListT('statusPlaceholder', 'Select status')}
              customStyles={{
                content: 'mt-1'
              }}
            />
          </div>

          {/* Client filter */}
          <ClientPicker
            id="project-client-filter"
            clients={clients}
            onSelect={(clientId) => handleFilterChange({ clientId: clientId || undefined })}
            selectedClientId={activeFilters.clientId || null}
            filterState={clientFilterState}
            onFilterStateChange={setClientFilterState}
            clientTypeFilter={clientClientTypeFilter}
            onClientTypeFilterChange={setClientClientTypeFilter}
            fitContent={true}
          />

          {/* Contact filter */}
          <ContactPicker
            id="project-contact-filter"
            contacts={contacts}
            value={activeFilters.contactId || ''}
            onValueChange={(value) => handleFilterChange({ contactId: value || undefined })}
            clientId={activeFilters.clientId || undefined}
            placeholder={projectListT('contactPlaceholder', 'Filter by contact')}
            buttonWidth="fit"
            onAddNew={() => setIsQuickAddContactOpen(true)}
          />
          {renderQuickAddContact({
            isOpen: isQuickAddContactOpen,
            onClose: () => setIsQuickAddContactOpen(false),
            onContactAdded: (newContact) => {
              setContacts((prevContacts) => {
                const existingIndex = prevContacts.findIndex((contact) => contact.contact_name_id === newContact.contact_name_id);
                if (existingIndex >= 0) {
                  const nextContacts = [...prevContacts];
                  nextContacts[existingIndex] = newContact;
                  return nextContacts;
                }
                return [...prevContacts, newContact];
              });
              handleFilterChange({ contactId: newContact.contact_name_id });
              setIsQuickAddContactOpen(false);
            },
            clients,
            selectedClientId: activeFilters.clientId || undefined,
          })}

          {/* Project Manager filter */}
          <UserPicker
            value={activeFilters.managerId || ''}
            onValueChange={(value) => handleFilterChange({ managerId: value || undefined })}
            users={users}
            getUserAvatarUrlsBatch={getUserAvatarUrlsBatchAction}
            placeholder={projectListT('managerPlaceholder', 'All managers')}
            buttonWidth="fit"
            labelStyle="none"
          />

          {/* Deadline filter */}
          <DeadlineFilter
            id="project-deadline-filter"
            value={deadlineFilterValue}
            onChange={(value) => {
              if (value) {
                handleFilterChange({
                  deadlineType: value.type,
                  deadlineDate: value.date ? value.date.toISOString().split('T')[0] : undefined,
                  deadlineEndDate: value.endDate ? value.endDate.toISOString().split('T')[0] : undefined,
                });
              } else {
                handleFilterChange({
                  deadlineType: undefined,
                  deadlineDate: undefined,
                  deadlineEndDate: undefined,
                });
              }
            }}
            placeholder={projectListT('deadlinePlaceholder', 'Filter by deadline')}
          />

          {/* Tag filter */}
          <TagFilter
            tags={allUniqueTags}
            selectedTags={activeFilters.tags || []}
            onToggleTag={(tag) => {
              const currentTags = activeFilters.tags || [];
              const newTags = currentTags.includes(tag)
                ? currentTags.filter(t => t !== tag)
                : [...currentTags, tag];
              handleFilterChange({ tags: newTags.length > 0 ? newTags : undefined });
            }}
            onClearTags={() => handleFilterChange({ tags: undefined })}
          />

          <Button
            id="clear-all-filters-button"
            variant="ghost"
            size="sm"
            onClick={() => {
              handleFilterChange({
                searchQuery: undefined,
                status: 'active',
                clientId: undefined,
                contactId: undefined,
                managerId: undefined,
                tags: undefined,
                deadlineType: undefined,
                deadlineDate: undefined,
                deadlineEndDate: undefined,
              });
              setClientFilterState('all');
              setClientClientTypeFilter('all');
            }}
            className={`shrink-0 flex items-center gap-1 ${(activeFilters.searchQuery || activeFilters.status !== 'active' || (activeFilters.tags && activeFilters.tags.length > 0) || activeFilters.clientId || activeFilters.contactId || activeFilters.managerId || activeFilters.deadlineType) ? 'text-gray-500 hover:text-gray-700' : 'invisible'}`}
            disabled={!(activeFilters.searchQuery || activeFilters.status !== 'active' || (activeFilters.tags && activeFilters.tags.length > 0) || activeFilters.clientId || activeFilters.contactId || activeFilters.managerId || activeFilters.deadlineType)}
          >
            <XCircle className="h-4 w-4" />
            {t('resetFilters', 'Reset')}
          </Button>
      </div>

      <div className="bg-white shadow rounded-lg p-4">
        <DataTable
          key={`${activeFilters.page}-${activeFilters.pageSize}`}
          id="projects-table"
          data={filteredProjects}
          columns={columns}
          pagination={true}
          currentPage={activeFilters.page || 1}
          onPageChange={(page) => handleFilterChange({ page })}
          pageSize={activeFilters.pageSize || 10}
          onItemsPerPageChange={(pageSize) => handleFilterChange({ pageSize, page: 1 })}
          initialSorting={[{ id: 'created_at', desc: true }]}
        />
      </div>

      {showQuickAdd && (
        <ProjectQuickAdd
          onClose={() => setShowQuickAdd(false)}
          onProjectAdded={handleProjectAdded}
          clients={clients}
        />
      )}

      {showApplyTemplate && (
        <ApplyTemplateDialog
          open={showApplyTemplate}
          onClose={() => setShowApplyTemplate(false)}
          onSuccess={(projectId) => {
            setShowApplyTemplate(false);
            // Refresh the page or add the new project to the list
            window.location.reload();
          }}
        />
      )}

      <DeleteEntityDialog
        id="delete-project-confirmation"
        isOpen={!!projectToDelete}
        onClose={resetDeleteState}
        onConfirmDelete={confirmDelete}
        entityName={projectToDelete?.project_name || projectListT('thisProject', 'this project')}
        validationResult={deleteValidation}
        isValidating={isDeleteValidating}
        isDeleting={isDeleteProcessing}
      />

      {/* Client Quick View Drawer */}
      <Drawer
        isOpen={isQuickViewOpen}
        onClose={() => {
          setIsQuickViewOpen(false);
          setQuickViewClient(null);
        }}
      >
        {quickViewClient && renderClientDetails({
            client: quickViewClient,
            isInDrawer: true,
            quickView: true,
          })}
      </Drawer>
    </div>
  );
}
