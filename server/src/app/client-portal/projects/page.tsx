import { ProjectsOverviewPage } from '@alga-psa/client-portal/components';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Projects',
};

export default function ProjectsPage() {
  return <ProjectsOverviewPage />;
}
