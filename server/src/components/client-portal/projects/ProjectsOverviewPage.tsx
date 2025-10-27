'use client';

import { useState, useEffect } from 'react';
import { getClientProjects } from '@product/actions/client-portal-actions/client-projects';
import { useDrawer } from "server/src/context/DrawerContext";
import { DrawerProvider } from "server/src/context/DrawerContext";
import ProjectDetailView from './ProjectDetailView';
import { ProjectCard } from './ProjectCard';
import { DataTable } from 'server/src/components/ui/DataTable';
import { Input } from 'server/src/components/ui/Input';
import { Button } from 'server/src/components/ui/Button';
import { Search, XCircle, ExternalLink } from 'lucide-react';
import { IProject } from 'server/src/interfaces/project.interfaces';
import { ColumnDefinition } from 'server/src/interfaces/dataTable.interfaces';
import { formatDateOnly } from 'server/src/lib/utils/dateTimeUtils';
import { useTranslation } from 'server/src/lib/i18n/client';

export function ProjectsOverviewPage() {
  const { t } = useTranslation('clientPortal');
  const [projects, setProjects] = useState<IProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalItems, setTotalItems] = useState(0);
  const [statusFilter, setStatusFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const pageSize = 10;
  const { openDrawer } = useDrawer();
  
  // Define columns for the DataTable
  const columns: ColumnDefinition<IProject>[] = [
    {
      title: t('projects.fields.projectName'),
      dataIndex: 'project_name',
      width: '30%',
      render: (value, record) => (
        <div className="font-medium">{value}</div>
      )
    },
    {
      title: t('projects.fields.reference'),
      dataIndex: 'wbs_code',
      width: '15%'
    },
    {
      title: t('projects.fields.status'),
      dataIndex: 'status_name',
      width: '15%',
      render: (value) => (
        <span className="px-2 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-800">
          {value || 'Unknown'}
        </span>
      )
    },
    {
      title: t('projects.fields.startDate'),
      dataIndex: 'start_date',
      width: '15%',
      render: (value) => value ? formatDateOnly(new Date(value)) : 'N/A'
    },
    {
      title: t('projects.fields.endDate'),
      dataIndex: 'end_date',
      width: '15%',
      render: (value) => value ? formatDateOnly(new Date(value)) : 'N/A'
    },
    {
      title: t('projects.details'),
      dataIndex: 'project_id',
      width: '10%',
      render: (_, record) => {
        return (
          <Button 
            id={`view-project-${record.project_id}`}
            variant="ghost" 
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              handleViewProject(record);
            }}
          >
            <ExternalLink className="h-4 w-4" />
          </Button>
        );
      }
    }
  ];
  
  // Fetch projects on initial load and when filters change
  useEffect(() => {
    async function loadProjects() {
      setLoading(true);
      try {
        const result = await getClientProjects({
          page,
          pageSize,
          status: statusFilter !== 'all' ? statusFilter : undefined,
          search: searchQuery || undefined
        });
        
        setProjects(result.projects);
        setTotalItems(result.total);
      } catch (error) {
        console.error('Error loading projects:', error);
      } finally {
        setLoading(false);
      }
    }
    
    loadProjects();
  }, [page, statusFilter, searchQuery]);
  
  const handleResetFilters = () => {
    setStatusFilter('all');
    setSearchQuery('');
  };
  
  const handleViewProject = (project: IProject) => {
    openDrawer(<ProjectDetailView project={project} />);
  };
  
  const handleRowClick = (project: IProject) => {
    handleViewProject(project);
  };
  
  return (
    <div className="container mx-auto py-6 space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-semibold">{t('projects.title')}</h1>
          <p className="text-gray-600">
            {t('projects.subtitle')}
          </p>
        </div>
      </div>
      
      {/* Filters */}
      <div className="flex flex-wrap gap-4">
        <div className="relative w-64">
          <Input
            id="project-search-input"
            type="text"
            placeholder={t('projects.searchPlaceholder')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10"
          />
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-5 w-5" />
        </div>
        
        <select
          id="project-status-filter"
          className="border border-gray-300 rounded-md px-3 py-2 text-sm"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
        >
          <option value="all">{t('projects.allStatuses')}</option>
          <option value="open">All Open Projects</option>
          <option value="closed">All Closed Projects</option>
          <option value="planning">Planning</option>
          <option value="in progress">In Progress</option>
          <option value="on hold">On Hold</option>
          <option value="completed">Completed</option>
          <option value="cancelled">Cancelled</option>
        </select>
        
        <Button
          id="reset-filters-button"
          variant="outline"
          onClick={handleResetFilters}
          className="whitespace-nowrap flex items-center gap-2 ml-auto"
        >
          <XCircle className="h-4 w-4" />
          {t('projects.resetFilters')}
        </Button>
      </div>
      
      {/* Projects Table */}
      <DataTable
        id="projects-table"
        data={projects}
        columns={columns}
        pagination={true}
        currentPage={page}
        onPageChange={setPage}
        pageSize={pageSize}
        totalItems={totalItems}
        onRowClick={handleRowClick}
      />
    </div>
  );
}

// Wrap the component with DrawerProvider in the parent component or page file
export default function ProjectsOverviewPageWithDrawer() {
  return (
    <DrawerProvider>
      <ProjectsOverviewPage />
    </DrawerProvider>
  );
}
