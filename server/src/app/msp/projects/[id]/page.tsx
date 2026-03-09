import type { Metadata } from 'next';
import { getProject } from '@alga-psa/projects/actions/projectActions';
import { AIChatContextBoundary } from '@product/chat/context';
import MspProjectPageClient from '@alga-psa/msp-composition/projects/MspProjectPageClient';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  try {
    const { id } = await params;
    const project = await getProject(id);
    if (project && 'project_name' in project) {
      return { title: project.project_name };
    }
  } catch (error) {
    console.error('[generateMetadata] Failed to fetch project title:', error);
  }
  return { title: 'Project Details' };
}

export default async function ProjectDetailsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return (
    <AIChatContextBoundary
      value={{
        pathname: `/msp/projects/${id}`,
        screen: {
          key: 'projects.detail',
          label: 'Project Details',
        },
        record: {
          type: 'project',
          id,
        },
      }}
    >
      <MspProjectPageClient params={params} />
    </AIChatContextBoundary>
  );
}
