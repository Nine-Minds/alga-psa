import Projects from '@alga-psa/projects/components/Projects';
import { getAllClientsForProjects, getProjects } from '@alga-psa/projects/actions/projectActions';
import type { IClient, IProject } from '@alga-psa/types';
import { isActionPermissionError } from '@alga-psa/ui/lib/errorHandling';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Projects',
};

export default async function ProjectsPage() {
  const [projectsResult, clientsData] = await Promise.all([
    getProjects(),
    getAllClientsForProjects() as Promise<IClient[]>
  ]);

  const projectsData: IProject[] = isActionPermissionError(projectsResult) ? [] : projectsResult;

  return (
    <Projects initialProjects={projectsData} clients={clientsData} />
  );
}

export const dynamic = "force-dynamic";
