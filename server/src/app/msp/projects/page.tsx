import Projects from '@alga-psa/projects/components/Projects';
import { getAllClientsForProjects, getProjects } from '@alga-psa/projects/actions/projectActions';
import type { IClient, IProject } from '@alga-psa/types';
import { isActionPermissionError } from '@alga-psa/ui/lib/errorHandling';
import type { Metadata } from 'next';
import type { ProjectListFilters } from '@alga-psa/projects/components/Projects';

export const metadata: Metadata = {
  title: 'Projects',
};

interface ProjectsPageProps {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

export default async function ProjectsPage({ searchParams }: ProjectsPageProps) {
  const [projectsResult, clientsData, params] = await Promise.all([
    getProjects(),
    getAllClientsForProjects() as Promise<IClient[]>,
    searchParams
  ]);

  const projectsData: IProject[] = isActionPermissionError(projectsResult) ? [] : projectsResult;

  // Parse search parameters into initial filter values
  const initialFilters: Partial<ProjectListFilters> = {};

  if (params?.searchQuery && typeof params.searchQuery === 'string') {
    initialFilters.searchQuery = params.searchQuery;
  }
  if (params?.status && typeof params.status === 'string') {
    if (params.status === 'all' || params.status === 'active' || params.status === 'inactive') {
      initialFilters.status = params.status;
    }
  }
  if (params?.clientId && typeof params.clientId === 'string') {
    initialFilters.clientId = params.clientId;
  }
  if (params?.contactId && typeof params.contactId === 'string') {
    initialFilters.contactId = params.contactId;
  }
  if (params?.managerId && typeof params.managerId === 'string') {
    initialFilters.managerId = params.managerId;
  }
  if (params?.tags) {
    const normalizeTags = (raw: string | string[]) => {
      const values = Array.isArray(raw) ? raw : raw.split(',');
      const decoded = values
        .map(tag => (typeof tag === 'string' ? decodeURIComponent(tag) : String(tag)).trim())
        .filter(tag => tag.length > 0);
      return Array.from(new Set(decoded));
    };
    initialFilters.tags = normalizeTags(params.tags);
  }
  if (params?.deadlineType && typeof params.deadlineType === 'string') {
    const allowedTypes = ['before', 'after', 'on', 'between'] as const;
    if ((allowedTypes as readonly string[]).includes(params.deadlineType)) {
      initialFilters.deadlineType = params.deadlineType as ProjectListFilters['deadlineType'];
      if (params.deadlineDate && typeof params.deadlineDate === 'string') {
        initialFilters.deadlineDate = params.deadlineDate;
      }
      if (params.deadlineEndDate && typeof params.deadlineEndDate === 'string') {
        initialFilters.deadlineEndDate = params.deadlineEndDate;
      }
    }
  }

  // Parse pagination
  const page = params?.page && typeof params.page === 'string' ? parseInt(params.page, 10) : undefined;
  const pageSize = params?.pageSize && typeof params.pageSize === 'string' ? parseInt(params.pageSize, 10) : undefined;
  if (page && Number.isFinite(page) && page > 0) {
    initialFilters.page = page;
  }
  if (pageSize && Number.isFinite(pageSize) && pageSize > 0) {
    initialFilters.pageSize = pageSize;
  }

  return (
    <Projects
      initialProjects={projectsData}
      clients={clientsData}
      initialFilters={initialFilters}
    />
  );
}

export const dynamic = "force-dynamic";
