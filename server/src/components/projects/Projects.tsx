'use client'

import React, { useState, useMemo } from 'react';
import Link from 'next/link';
import { DataTable } from '@/components/ui/DataTable';
import { ColumnDefinition } from '@/interfaces/dataTable.interfaces';
import { IProject, ICompany } from '@/interfaces';
import { Button } from '@/components/ui/Button';
import CustomSelect from '@/components/ui/CustomSelect';
import ProjectQuickAdd from './ProjectQuickAdd';
import { deleteProject } from '@/lib/actions/project-actions/projectActions';
import { getContactByContactNameId } from '@/lib/actions/contact-actions/contactActions';
import { findUserById } from '@/lib/actions/user-actions/userActions';
import { toast } from 'react-hot-toast';
import { Search, MoreVertical, Pen, Trash2 } from 'lucide-react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { useDrawer } from '@/context/DrawerContext';
import ProjectDetailsEdit from './ProjectDetailsEdit';

interface ProjectsProps {
  initialProjects: IProject[];
  companies: ICompany[];
}

export default function Projects({ initialProjects, companies }: ProjectsProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState<'all' | 'active' | 'inactive'>('active');
  const [projects, setProjects] = useState<IProject[]>(initialProjects);
  const [showQuickAdd, setShowQuickAdd] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [projectToDelete, setProjectToDelete] = useState<IProject | null>(null);
  const { openDrawer, closeDrawer } = useDrawer();

  const filteredProjects = useMemo(() => {
    return projects.filter(project =>
      project.project_name.toLowerCase().includes(searchTerm.toLowerCase()) &&
      (filterStatus === 'all' || 
       (filterStatus === 'active' && !project.is_inactive) ||
       (filterStatus === 'inactive' && project.is_inactive))
    );
  }, [projects, searchTerm, filterStatus]);

  const handleEditProject = (project: IProject) => {
    openDrawer(
      <ProjectDetailsEdit
        initialProject={project}
        companies={companies}
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

  const columns: ColumnDefinition<IProject>[] = [
    {
      title: 'Project Name',
      dataIndex: 'project_name',
      width: '25%',
      render: (text: string, record: IProject) => (
        <Link href={`/msp/projects/${record.project_id}`} className="text-blue-600 hover:text-blue-800 block truncate">
          {text}
        </Link>
      ),
    },
    {
      title: 'Client',
      dataIndex: 'company_id',
      width: '20%',
      render: (value, record) => {
        const company = companies.find(c => c.company_id === value);
        return company ? company.company_name : 'No Client';
      }
    },
    {
      title: 'Contact',
      dataIndex: 'contact_name',
      width: '20%',
      render: (name: string | null) => name || 'No Contact',
    },
    {
      title: 'Deadline',
      dataIndex: 'end_date',
      width: '15%',
      render: (value: string | null) => value ? new Date(value).toLocaleDateString() : 'N/A',
    },
    {
      title: 'Assigned To',
      dataIndex: 'assigned_to',
      width: '15%',
      render: (userId: string | null, record: IProject) => {
        if (!userId) return 'Unassigned';
        const user = record.assigned_user;
        return user ? `${user.first_name} ${user.last_name}` : 'Unassigned';
      }
    },
    {
      title: 'Actions',
      dataIndex: 'actions',
      width: '5%',
      render: (_: unknown, record: IProject) => (
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <div
              role="button"
              tabIndex={0}
              className="inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 hover:bg-accent hover:text-accent-foreground h-9 w-9 p-0"
            >
              <MoreVertical size={16} />
            </div>
          </DropdownMenu.Trigger>
          <DropdownMenu.Content className="bg-white rounded-md shadow-lg p-1">
            <DropdownMenu.Item 
              className="px-2 py-1 text-sm cursor-pointer hover:bg-gray-100 flex items-center"
              onSelect={() => handleEditProject(record)}
            >
              <Pen size={14} className="mr-2" />
              Edit
            </DropdownMenu.Item>
            <DropdownMenu.Item 
              className="px-2 py-1 text-sm cursor-pointer hover:bg-gray-100 flex items-center text-red-600"
              onSelect={() => handleDelete(record)}
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
        <div className="flex items-center space-x-4">
          <div className="relative">
            <input
              type="text"
              placeholder="Search projects"
              className="border-2 border-gray-200 focus:border-purple-500 rounded-md pl-10 pr-4 py-2 w-64 outline-none bg-white"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
            <Search size={20} className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" />
          </div>
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
          <Button id='add-project-button' onClick={() => setShowQuickAdd(true)}>
            Add Project
          </Button>
        </div>
      </div>

      <div className="bg-white shadow rounded-lg p-4">
        <DataTable
          data={filteredProjects}
          columns={columns}
        />
      </div>

      {showQuickAdd && (
        <ProjectQuickAdd
          onClose={() => setShowQuickAdd(false)}
          onProjectAdded={handleProjectAdded}
          companies={companies}
        />
      )}

      {showDeleteConfirm && projectToDelete && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center">
          <div className="bg-white p-6 rounded-lg shadow-lg">
            <h2 className="text-xl font-bold mb-4">Delete Project</h2>
            <p className="mb-4">
              Are you sure you want to delete project "{projectToDelete.project_name}"? This action cannot be undone.
            </p>
            <div className="flex justify-end space-x-4">
              <Button
                id='cancel-button'
                variant="outline"
                onClick={() => {
                  setShowDeleteConfirm(false);
                  setProjectToDelete(null);
                }}
              >
                Cancel
              </Button>
              <Button
                id='delete-button'
                variant="destructive"
                onClick={confirmDelete}
              >
                Delete
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
