'use client'

import React, { useState, useMemo, useEffect, useRef } from 'react';
import Link from 'next/link';
import { DataTable } from 'server/src/components/ui/DataTable';
import { ColumnDefinition } from 'server/src/interfaces/dataTable.interfaces';
import { IProject, IClient } from 'server/src/interfaces';
import { ITag } from 'server/src/interfaces/tag.interfaces';
import { Button } from 'server/src/components/ui/Button';
import CustomSelect from 'server/src/components/ui/CustomSelect';
import ProjectQuickAdd from './ProjectQuickAdd';
import { deleteProject } from 'server/src/lib/actions/project-actions/projectActions';
import { getContactByContactNameId } from 'server/src/lib/actions/contact-actions/contactActions';
import { findUserById } from 'server/src/lib/actions/user-actions/userActions';
import { findTagsByEntityIds, findAllTagsByType } from 'server/src/lib/actions/tagActions';
import { TagFilter, TagManager } from 'server/src/components/tags';
import { useTagPermissions } from 'server/src/hooks/useTagPermissions';
import { ConfirmationDialog } from 'server/src/components/ui/ConfirmationDialog';
import { toast } from 'react-hot-toast';
import { Search, MoreVertical, Pen, Trash2, XCircle, ExternalLink, FileText } from 'lucide-react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { useDrawer } from "server/src/context/DrawerContext";
import ProjectDetailsEdit from './ProjectDetailsEdit';
import { Input } from 'server/src/components/ui/Input';
import { ClientPicker } from 'server/src/components/clients/ClientPicker';
import { ContactPicker } from 'server/src/components/ui/ContactPicker';
import UserPicker from 'server/src/components/ui/UserPicker';
import { DatePicker } from 'server/src/components/ui/DatePicker';
import { DeadlineFilter, DeadlineFilterValue } from './DeadlineFilter';
import { IContact } from 'server/src/interfaces/contact.interfaces';
import { IUserWithRoles } from 'server/src/interfaces/auth.interfaces';
import { getAllContacts } from 'server/src/lib/actions/contact-actions/contactActions';
import { getAllUsers } from 'server/src/lib/actions/user-actions/userActions';
import Drawer from 'server/src/components/ui/Drawer';
import ClientDetails from 'server/src/components/clients/ClientDetails';
import { ApplyTemplateDialog } from './project-templates/ApplyTemplateDialog';

interface ProjectsProps {
  initialProjects: IProject[];
  clients: IClient[];
}

export default function Projects({ initialProjects, clients }: ProjectsProps) {
  // Pre-fetch tag permissions to prevent individual API calls
  useTagPermissions(['project']);
  
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState<'all' | 'active' | 'inactive'>('active');
  const [projects, setProjects] = useState<IProject[]>(initialProjects);
  const [showQuickAdd, setShowQuickAdd] = useState(false);
  const [showApplyTemplate, setShowApplyTemplate] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [projectToDelete, setProjectToDelete] = useState<IProject | null>(null);
  const { openDrawer, closeDrawer } = useDrawer();
  
  // Tag-related state
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const projectTagsRef = useRef<Record<string, ITag[]>>({});
  const [allUniqueTags, setAllUniqueTags] = useState<ITag[]>([]);
  
  // New filter states
  const [filterClientId, setFilterClientId] = useState<string | null>(null);
  const [filterContactId, setFilterContactId] = useState<string | null>(null);
  const [filterManagerId, setFilterManagerId] = useState<string | null>(null);
  const [filterDeadline, setFilterDeadline] = useState<DeadlineFilterValue | undefined>(undefined);
  const [clientFilterState, setClientFilterState] = useState<'all' | 'active' | 'inactive'>('all');
  const [clientClientTypeFilter, setClientClientTypeFilter] = useState<'all' | 'company' | 'individual'>('all');
  
  // Data for pickers
  const [contacts, setContacts] = useState<IContact[]>([]);
  const [users, setUsers] = useState<IUserWithRoles[]>([]);
  
  // Quick View state
  const [quickViewClient, setQuickViewClient] = useState<IClient | null>(null);
  const [isQuickViewOpen, setIsQuickViewOpen] = useState(false);

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

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
          getAllUsers(true)
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

  const handleDelete = async (project: IProject) => {
    setProjectToDelete(project);
    setShowDeleteConfirm(true);
  };

  const confirmDelete = async () => {
    if (!projectToDelete) return;

    try {
      await deleteProject(projectToDelete.project_id);
      setProjects(projects.filter(p => p.project_id !== projectToDelete.project_id));
      toast.success('Project deleted successfully');
    } catch (error) {
      console.error('Error deleting project:', error);
      toast.error('Failed to delete project');
    } finally {
      setShowDeleteConfirm(false);
      setProjectToDelete(null);
    }
  };

  const onQuickViewClient = (clientId: string) => {
    const client = clients.find(c => c.client_id === clientId);
    if (client) {
      setQuickViewClient(client);
      setIsQuickViewOpen(true);
    }
  };

  const columns: ColumnDefinition<IProject>[] = [
    {
      title: 'Number',
      dataIndex: 'project_number',
      width: '10%',
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
      width: '18%',
      render: (text: string, record: IProject) => (
        <Link href={`/msp/projects/${record.project_id}`} className="text-blue-600 hover:text-blue-800 block whitespace-normal break-words">
          {text}
        </Link>
      ),
    },
    {
      title: 'Client',
      dataIndex: 'client_id',
      width: '15%',
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
      width: '15%',
      render: (name: string | null) => name || 'No Contact',
    },
    {
      title: 'Status',
      dataIndex: 'status_name',
      width: '10%',
      render: (_: string | null, record: IProject) => (
        <div className="inline-flex items-center px-2.5 py-0.5 text-sm text-gray-800">
          {record.status_name || 'Unknown'}
        </div>
      ),
    },
    {
      title: 'Deadline',
      dataIndex: 'end_date',
      width: '10%',
      render: (value: string | null) => value ? new Date(value).toLocaleDateString() : 'N/A',
    },
    {
      title: 'Project Manager',
      dataIndex: 'assigned_to',
      width: '15%',
      render: (userId: string | null, record: IProject) => {
        if (!userId) return 'Unassigned';
        const user = record.assigned_user;
        return user ? `${user.first_name} ${user.last_name}` : 'Unassigned';
      }
    },
    {
      title: 'Tags',
      dataIndex: 'tags',
      width: '20%',
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
              className="px-2 py-1 text-sm cursor-pointer hover:bg-gray-100 flex items-center text-red-600"
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
      <div className="mb-6 flex flex-wrap items-center gap-2">
        {/* Search bar */}
        <div className="relative">
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
        <div className="relative z-10">
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
        />

        {/* Project Manager filter */}
        <UserPicker
          value={filterManagerId || ''}
          onValueChange={(value) => setFilterManagerId(value || null)}
          users={users}
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
          allTags={allUniqueTags}
          selectedTags={selectedTags}
          onTagSelect={(tag) => {
            setSelectedTags(prev => 
              prev.includes(tag) 
                ? prev.filter(t => t !== tag)
                : [...prev, tag]
            );
          }}
        />

        {/* Clear filters button */}
        {(searchTerm || filterStatus !== 'active' || selectedTags.length > 0 || 
          filterClientId || filterContactId || filterManagerId || filterDeadline) && (
          <Button
            id="clear-all-filters-button"
            variant="outline"
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
            className="flex items-center gap-1 bg-white"
          >
            <XCircle className="h-4 w-4" />
            <span>Clear all filters</span>
          </Button>
        )}
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
          initialSorting={[{ id: 'end_date', desc: false }]}
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

      <ConfirmationDialog
        id="delete-project-confirmation"
        isOpen={showDeleteConfirm}
        onClose={() => {
          setShowDeleteConfirm(false);
          setProjectToDelete(null);
        }}
        onConfirm={confirmDelete}
        title="Delete Project"
        message={projectToDelete ? `Are you sure you want to delete project "${projectToDelete.project_name}"? This action cannot be undone.` : ""}
        confirmLabel="Delete"
        cancelLabel="Cancel"
      />

      {/* Client Quick View Drawer */}
      <Drawer
        isOpen={isQuickViewOpen}
        onClose={() => {
          setIsQuickViewOpen(false);
          setQuickViewClient(null);
        }}
      >
        {quickViewClient && (
          <ClientDetails
            client={quickViewClient}
            isInDrawer={true}
            quickView={true}
          />
        )}
      </Drawer>
    </div>
  );
}
