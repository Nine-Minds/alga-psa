'use client';

import { useEffect, useState } from 'react';
import Projects from 'server/src/components/projects/Projects';
import { getProjects } from '@product/actions/project-actions/projectActions';
import { getAllClients } from '@product/actions/client-actions/clientActions';
import { IProject } from 'server/src/interfaces/project.interfaces';
import { IClient } from 'server/src/interfaces';

export default function ProjectsPage() {
  const [projects, setProjects] = useState<IProject[]>([]);
  const [clients, setClients] = useState<IClient[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [projectsData, clientsData] = await Promise.all([
          getProjects() as Promise<IProject[]>,
          getAllClients() as Promise<IClient[]>
        ]);
        setProjects(projectsData);
        setClients(clientsData);
      } catch(e) {
        console.error('Error loading projects page:', e);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, []); // Empty dependency array means this runs once on mount and when navigating back

  if (loading) {
    return <div>Loading...</div>;
  }

  return <Projects initialProjects={projects} clients={clients} />;
}
