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
}

export default function Projects({ initialProjects, clients, initialFilters }: ProjectsProps) {
  const { getAllContacts, getContactByContactNameId, renderQuickAddContact, renderClientDetails } = useClientIntegration();
  // Pre-fetch tag permissions to prevent individual API calls
  useTagPermissions(['project']);
  
  // Build initial deadline filter from URL params
  const initialDeadline = useMemo((): DeadlineFilterValue | undefined => {
    if (!initialFilters?.deadlineType) return undefined;
    const result: DeadlineFilterValue = { type: initialFilters.deadlineType };
    if (initialFilters.deadlineDate) result.date = new Date(initialFilters.deadlineDate);
    if (initialFilters.deadlineEndDate) result.endDate = new Date(initialFilters.deadlineEndDate);
    return result;
  }, [initialFilters?.deadlineType, initialFilters?.deadlineDate, initialFilters?.deadlineEndDate]);

  const [searchTerm, setSearchTerm] = useState(initialFilters?.searchQuery || '');
  const [filterStatus, setFilterStatus] = useState<'all' | 'active' | 'inactive'>(initialFilters?.status || 'active');
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

  // Tag-related state
  const [selectedTags, setSelectedTags] = useState<string[]>(initialFilters?.tags || []);
  const projectTagsRef = useRef<Record<string, ITag[]>>({});
  const [allUniqueTags, setAllUniqueTags] = useState<ITag[]>([]);
  const [tagsVersion, setTagsVersion] = useState(0); // Used to force re-render when tags are fetched

  // New filter states
  const [filterClientId, setFilterClientId] = useState<string | null>(initialFilters?.clientId || null);
  const [filterContactId, setFilterContactId] = useState<string | null>(initialFilters?.contactId || null);
  const [isQuickAddContactOpen, setIsQuickAddContactOpen] = useState(false);
  const [filterManagerId, setFilterManagerId] = useState<string | null>(initialFilters?.managerId || null);
  const [filterDeadline, setFilterDeadline] = useState<DeadlineFilterValue | undefined>(initialDeadline);
  const [clientFilterState, setClientFilterState] = useState<'all' | 'active' | 'inactive'>('all');
  const [clientClientTypeFilter, setClientClientTypeFilter] = useState<'all' | 'company' | 'individual'>('all');

  // Data for pickers
  const [contacts, setContacts] = useState<IContact[]>([]);
  const [users, setUsers] = useState<IUser[]>([]);

  // Quick View state
  const [quickViewClient, setQuickViewClient] = useState<IClient | null>(null);
  const [isQuickViewOpen, setIsQuickViewOpen] = useState(false);

  // Pagination state
  const [currentPage, setCurrentPage] = useState(initialFilters?.page || 1);
  const [pageSize, setPageSize] = useState(initialFilters?.pageSize || 10);

  // Ref to track last applied URL search string (prevents duplicate updates)
  const lastAppliedSearchRef = useRef<string>('');
  const isSyncingFromHistoryRef = useRef(false);

  // Sync filter state to URL
  const updateURLWithFilters = useCallback(() => {
    if (isSyncingFromHistoryRef.current) return;

    const filters: ProjectListFilters = {};
    if (searchTerm) filters.searchQuery = searchTerm;
    if (filterStatus !== 'active') filters.status = filterStatus;
    if (filterClientId) filters.clientId = filterClientId;
    if (filterContactId) filters.contactId = filterContactId;
    if (filterManagerId) filters.managerId = filterManagerId;
    if (selectedTags.length > 0) filters.tags = selectedTags;
    if (filterDeadline?.type) {
      filters.deadlineType = filterDeadline.type;
      if (filterDeadline.date) filters.deadlineDate = filterDeadline.date.toISOString().split('T')[0];
      if (filterDeadline.endDate) filters.deadlineEndDate = filterDeadline.endDate.toISOString().split('T')[0];
    }
    if (currentPage !== 1) filters.page = currentPage;
    if (pageSize !== 10) filters.pageSize = pageSize;

    const newURL = buildURLFromFilters(filters);
    const newSearch = newURL.includes('?') ? newURL.slice(newURL.indexOf('?')) : '';
    window.history.replaceState(null, '', newURL);
    lastAppliedSearchRef.current = newSearch;
  }, [searchTerm, filterStatus, filterClientId, filterContactId, filterManagerId, selectedTags, filterDeadline, currentPage, pageSize]);

  // Update URL whenever filters change (debounced for search term)
  const urlUpdateTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (urlUpdateTimeoutRef.current) clearTimeout(urlUpdateTimeoutRef.current);
    urlUpdateTimeoutRef.current = setTimeout(() => {
      updateURLWithFilters();
    }, 300);
    return () => {
      if (urlUpdateTimeoutRef.current) clearTimeout(urlUpdateTimeoutRef.current);
    };
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
      setSearchTerm(parsed.searchQuery || '');
      setFilterStatus(parsed.status || 'active');
      setFilterClientId(parsed.clientId || null);
      setFilterContactId(parsed.contactId || null);
      setFilterManagerId(parsed.managerId || null);
      setSelectedTags(parsed.tags || []);
      if (parsed.deadlineType) {
        const deadline: DeadlineFilterValue = { type: parsed.deadlineType };
        if (parsed.deadlineDate) deadline.date = new Date(parsed.deadlineDate);
        if (parsed.deadlineEndDate) deadline.endDate = new Date(parsed.deadlineEndDate);
        setFilterDeadline(deadline);
      } else {
        setFilterDeadline(undefined);
      }
      setCurrentPage(parsed.page || 1);
      setPageSize(parsed.pageSize || 10);
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
    };
  }, [syncFromUrl]);

  // Handle page size change - reset to page 1
  const handlePageSizeChange = (newPageSize: number) => {
    setPageSize(newPageSize);
    setCurrentPage(1);
  };

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
    let filtered = projects.filter(project =>
      (project.project_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
       project.project_number?.toLowerCase().includes(searchTerm.toLowerCase())) &&
      (filterStatus === 'all' ||
       (filterStatus === 'active' && !project.is_inactive) ||
       (filterStatus === 'inactive' && project.is_inactive))
    );

    // Apply tag filter if tags are selected
    if (selectedTags.length > 0) {
      filtered = filtered.filter(project => {
        const projectTags = projectTagsRef.current[project.project_id || ''] || [];
        const projectTagTexts = projectTags.map(tag => tag.tag_text);
        
        // Check if project has any of the selected tags
        return selectedTags.some(selectedTag => projectTagTexts.includes(selectedTag));
      });
    }

    // Apply client filter
    if (filterClientId) {
      filtered = filtered.filter(project => project.client_id === filterClientId);
    }

    // Apply contact filter
    if (filterContactId) {
      filtered = filtered.filter(project => project.contact_name_id === filterContactId);
    }

    // Apply project manager filter
    if (filterManagerId) {
      filtered = filtered.filter(project => project.assigned_to === filterManagerId);
    }

    // Apply deadline filter
    if (filterDeadline && filterDeadline.date) {
      filtered = filtered.filter(project => {
        if (!project.end_date) return false;
        const projectDeadline = new Date(project.end_date);
        const filterDate = filterDeadline.date!;
        
        switch (filterDeadline.type) {
          case 'before':
            return projectDeadline < filterDate;
          case 'after':
            return projectDeadline > filterDate;
          case 'on':
            const projectDay = projectDeadline.toISOString().split('T')[0];
            const filterDay = filterDate.toISOString().split('T')[0];
            return projectDay === filterDay;
          case 'between':
            if (!filterDeadline.endDate) return false;
            return projectDeadline >= filterDate && projectDeadline <= filterDeadline.endDate;
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
  }, [projects, searchTerm, filterStatus, selectedTags, filterClientId, filterContactId, filterManagerId, filterDeadline]);

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
        message: 'Failed to validate deletion. Please try again.',
        dependencies: [],
        alternatives: []
      });
    } finally {
      setIsDeleteValidating(false);
    }
  }, []);

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
      toast.success('Project deleted successfully');
      resetDeleteState();
    } catch (error) {
      console.error('Error deleting project:', error);
      setDeleteValidation({
        canDelete: false,
        code: 'VALIDATION_FAILED',
        message: 'Failed to delete project.',
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
    if (value == null) return 'N/A';

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
    if (!datePart) return 'N/A';

    // Use a date-only value to keep SSR and client rendering consistent regardless of timezone.
    const date = parse(datePart, 'yyyy-MM-dd', new Date());
    return isNaN(date.getTime()) ? 'N/A' : date.toLocaleDateString();
  };

  const columns: ColumnDefinition<IProject>[] = [
    {
      title: 'Number',
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
      title: 'Project Name',
      dataIndex: 'project_name',
      width: '15%',
      render: (text: string, record: IProject) => (
        <Link href={`/msp/projects/${record.project_id}`} className="text-blue-600 hover:text-blue-800 block whitespace-normal break-words">
          {text}
        </Link>
      ),
    },
    {
      title: 'Client',
      dataIndex: 'client_id',
      width: '12%',
      render: (value, record) => {
        const client = clients.find(c => c.client_id === value);
        if (!client) return 'No Client';

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
      title: 'Contact',
      dataIndex: 'contact_name',
      width: '10%',
      render: (name: string | null) => name || 'No Contact',
    },
    {
      title: 'Status',
      dataIndex: 'status_name',
      width: '8%',
      render: (_: string | null, record: IProject) => (
        <div className="inline-flex items-center px-2.5 py-0.5 text-sm text-gray-800">
          {record.status_name || 'Unknown'}
        </div>
      ),
    },
    {
      title: 'Deadline',
      dataIndex: 'end_date',
      width: '8%',
      render: (value: unknown) => formatDisplayDate(value),
    },
    {
      title: 'Created',
      dataIndex: 'created_at',
      width: '8%',
      render: (value: unknown) => formatDisplayDate(value),
    },
    {
      title: 'Project Manager',
      dataIndex: 'assigned_to',
      width: '12%',
      render: (userId: string | null, record: IProject) => {
        if (!userId) return 'Unassigned';
        const user = record.assigned_user;
        return user ? `${user.first_name} ${user.last_name}` : 'Unassigned';
      }
    },
    {
      title: 'Tags',
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
      title: 'Actions',
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
              <span className="sr-only">Open menu</span>
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
              Edit
            </DropdownMenu.Item>
            <DropdownMenu.Item
              className="px-2 py-1 text-sm cursor-pointer hover:bg-gray-100 flex items-center text-destructive"
              onSelect={(e) => {
                e.stopPropagation();
                handleDelete(record);
              }}
            >
              <Trash2 size={14} className="mr-2" />
              Delete
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

  const statusOptions = [
    { value: 'all', label: 'All projects' },
    { value: 'active', label: 'Active projects' },
    { value: 'inactive', label: 'Inactive projects' }
  ];

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">Projects</h1>
        <div className="flex items-center gap-3">
          <Button
            id='create-from-template-button'
            onClick={() => setShowApplyTemplate(true)}
            variant="outline"
          >
            <FileText className="h-4 w-4 mr-2" />
            Create from Template
          </Button>
          <Button id='add-project-button' onClick={() => setShowQuickAdd(true)}>
            Add Project
          </Button>
        </div>
      </div>

      {/* Filter section */}
      <div className="mb-6 flex items-center gap-2">
          {/* Search bar */}
          <div className="relative p-0.5 shrink-0">
            <Input
              type="text"
              placeholder="Search projects"
              className="pl-10 pr-4 py-2 w-64"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
            <Search size={20} className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" />
          </div>

          {/* Status filter */}
          <div className="relative z-10 shrink-0">
            <CustomSelect
              options={statusOptions}
              value={filterStatus}
              onValueChange={(value) => setFilterStatus(value as 'all' | 'active' | 'inactive')}
              placeholder="Select status"
              customStyles={{
                content: 'mt-1'
              }}
            />
          </div>

          {/* Client filter */}
          <ClientPicker
            id="project-client-filter"
            clients={clients}
            onSelect={(clientId) => setFilterClientId(clientId)}
            selectedClientId={filterClientId}
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
            value={filterContactId || ''}
            onValueChange={(value) => setFilterContactId(value || null)}
            clientId={filterClientId || undefined}
            placeholder="Filter by contact"
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
              setFilterContactId(newContact.contact_name_id);
              setIsQuickAddContactOpen(false);
            },
            clients,
            selectedClientId: filterClientId || undefined,
          })}

          {/* Project Manager filter */}
          <UserPicker
            value={filterManagerId || ''}
            onValueChange={(value) => setFilterManagerId(value || null)}
            users={users}
            getUserAvatarUrlsBatch={getUserAvatarUrlsBatchAction}
            placeholder="All managers"
            buttonWidth="fit"
            labelStyle="none"
          />

          {/* Deadline filter */}
          <DeadlineFilter
            id="project-deadline-filter"
            value={filterDeadline}
            onChange={setFilterDeadline}
            placeholder="Filter by deadline"
          />

          {/* Tag filter */}
          <TagFilter
            tags={allUniqueTags}
            selectedTags={selectedTags}
            onToggleTag={(tag) => {
              setSelectedTags(prev =>
                prev.includes(tag)
                  ? prev.filter(t => t !== tag)
                  : [...prev, tag]
              );
            }}
            onClearTags={() => setSelectedTags([])}
          />

          <Button
            id="clear-all-filters-button"
            variant="ghost"
            size="sm"
            onClick={() => {
              setSearchTerm('');
              setFilterStatus('active');
              setSelectedTags([]);
              setFilterClientId(null);
              setFilterContactId(null);
              setFilterManagerId(null);
              setFilterDeadline(undefined);
              setClientFilterState('all');
              setClientClientTypeFilter('all');
            }}
            className={`shrink-0 flex items-center gap-1 ${(searchTerm || filterStatus !== 'active' || selectedTags.length > 0 || filterClientId || filterContactId || filterManagerId || filterDeadline) ? 'text-gray-500 hover:text-gray-700' : 'invisible'}`}
            disabled={!(searchTerm || filterStatus !== 'active' || selectedTags.length > 0 || filterClientId || filterContactId || filterManagerId || filterDeadline)}
          >
            <XCircle className="h-4 w-4" />
            Reset
          </Button>
      </div>

      <div className="bg-white shadow rounded-lg p-4">
        <DataTable
          key={`${currentPage}-${pageSize}`}
          id="projects-table"
          data={filteredProjects}
          columns={columns}
          pagination={true}
          currentPage={currentPage}
          onPageChange={setCurrentPage}
          pageSize={pageSize}
          onItemsPerPageChange={handlePageSizeChange}
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
        entityName={projectToDelete?.project_name || 'this project'}
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
