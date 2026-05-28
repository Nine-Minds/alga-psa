import type { Metadata } from 'next';
import ProjectTaskSearchRedirectClient from './ProjectTaskSearchRedirectClient';

interface ProjectTaskSearchRedirectPageProps {
  params: Promise<{
    id: string;
    taskId: string;
  }>;
}

export const metadata: Metadata = {
  title: 'Project Task',
};

export default async function ProjectTaskSearchRedirectPage({
  params,
}: ProjectTaskSearchRedirectPageProps) {
  const { id, taskId } = await params;
  return <ProjectTaskSearchRedirectClient projectId={id} taskId={taskId} />;
}

export const dynamic = 'force-dynamic';
