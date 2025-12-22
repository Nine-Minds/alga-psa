import Projects from 'server/src/components/projects/Projects';
import { getProjects } from 'server/src/lib/actions/project-actions/projectActions';
import { getAllClients } from 'server/src/lib/actions/client-actions/clientActions';
import { IProject } from 'server/src/interfaces/project.interfaces';
import { IClient } from 'server/src/interfaces';

export default async function ProjectsPage() {
  const [projectsData, clientsData] = await Promise.all([
    getProjects() as Promise<IProject[]>,
    getAllClients() as Promise<IClient[]>
  ]);

  return <Projects initialProjects={projectsData} clients={clientsData} />;
}

export const dynamic = "force-dynamic";
