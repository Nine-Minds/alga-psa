import type { Metadata } from 'next';
import { getServerTranslation } from '@alga-psa/ui/lib/i18n/serverOnly';
import ProjectTaskSearchRedirectClient from './ProjectTaskSearchRedirectClient';

interface ProjectTaskSearchRedirectPageProps {
  params: Promise<{
    id: string;
    taskId: string;
  }>;
}

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerTranslation(undefined, 'metadata');

  return {
    title: t('msp.projects.detail.tasks.detail.title', { defaultValue: 'Project Task' }),
  };
}

export default async function ProjectTaskSearchRedirectPage({
  params,
}: ProjectTaskSearchRedirectPageProps) {
  const { id, taskId } = await params;
  return <ProjectTaskSearchRedirectClient projectId={id} taskId={taskId} />;
}

export const dynamic = 'force-dynamic';
