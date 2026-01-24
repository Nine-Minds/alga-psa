import Projects from '@alga-psa/projects/components/Projects';
import { getAllClientsForProjects, getProjects } from '@alga-psa/projects/actions/projectActions';
import type { IClient, IProject } from '@alga-psa/types';

export default async function ProjectsPage() {
  const [projectsData, clientsData] = await Promise.all([
    getProjects() as Promise<IProject[]>,
    getAllClientsForProjects() as Promise<IClient[]>
  ]);

  return <Projects initialProjects={projectsData} clients={clientsData} />;
}

export const dynamic = "force-dynamic";
