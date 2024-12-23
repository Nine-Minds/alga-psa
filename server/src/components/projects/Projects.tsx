// server/src/components/projects/Projects.tsx
'use client'

import React, { useState, useMemo } from 'react';
import Link from 'next/link';
import { DataTable } from '@/components/ui/DataTable';
import { ColumnDefinition } from '@/interfaces/dataTable.interfaces';
import { IProject, ICompany } from '@/interfaces';
import { Button } from '@/components/ui/Button';
import CustomSelect from '@/components/ui/CustomSelect';
import ProjectQuickAdd from './ProjectQuickAdd';
import { deleteProject } from '@/lib/actions/projectActions';
import { toast } from 'react-hot-toast';
import { Search } from 'lucide-react';

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

  const filteredProjects = useMemo(() => {
    return projects.filter(project =>
      project.project_name.toLowerCase().includes(searchTerm.toLowerCase()) &&
      (filterStatus === 'all' || 
       (filterStatus === 'active' && !project.is_inactive) ||
       (filterStatus === 'inactive' && project.is_inactive))
    );
  }, [projects, searchTerm, filterStatus]);

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
      render: (text: string, record: IProject) => (
        <Link href={`/msp/projects/${record.project_id}`} className="text-blue-600 hover:text-blue-800">
          {text}
        </Link>
      ),
    },
    {
      title: 'Client',
      dataIndex: 'client_name',
    },
    {
      title: 'Deadline',
      dataIndex: 'end_date',
      render: (value: string | null) => value ? new Date(value).toLocaleDateString() : 'N/A',
    },
    {
      title: 'Actions',
      dataIndex: 'actions',
      render: (_: unknown, record: IProject) => (
        <Button 
          variant="destructive" 
          onClick={(e) => {
            e.preventDefault();
            handleDelete(record);
          }}
        >
          Delete
        </Button>
      ),
    },
  ];

  const handleProjectAdded = (newProject: IProject) => {
    setProjects([...projects, newProject]);
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
          <Button onClick={() => setShowQuickAdd(true)}>
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
                variant="outline"
                onClick={() => {
                  setShowDeleteConfirm(false);
                  setProjectToDelete(null);
                }}
              >
                Cancel
              </Button>
              <Button
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
