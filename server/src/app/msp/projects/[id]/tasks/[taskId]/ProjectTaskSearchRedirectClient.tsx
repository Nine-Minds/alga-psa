'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

interface ProjectTaskSearchRedirectClientProps {
  projectId: string;
  taskId: string;
}

export default function ProjectTaskSearchRedirectClient({
  projectId,
  taskId,
}: ProjectTaskSearchRedirectClientProps) {
  const router = useRouter();

  useEffect(() => {
    const hash = window.location.hash || '';
    router.replace(
      `/msp/projects/${encodeURIComponent(projectId)}?taskId=${encodeURIComponent(taskId)}${hash}`
    );
  }, [projectId, router, taskId]);

  return <div id="project-task-search-redirect" />;
}
