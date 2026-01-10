'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { Button } from 'server/src/components/ui/Button';
import ProjectDetailView from 'server/src/components/client-portal/projects/ProjectDetailView';
import { useTranslation } from 'server/src/lib/i18n/client';
import { IProject } from 'server/src/interfaces/project.interfaces';

interface ProjectDetailsContainerProps {
  project: IProject;
}

export default function ProjectDetailsContainer({ project }: ProjectDetailsContainerProps) {
  const router = useRouter();
  const { t } = useTranslation('clientPortal');

  const handleBack = () => {
    router.push('/client-portal/projects');
  };

  // Validate required project data
  if (!project || !project.project_id) {
    return (
      <div id="project-invalid-data" className="p-4 bg-red-50 border border-red-200 rounded-lg">
        <p className="text-red-700">{t('projects.invalidProjectData', 'Invalid project data')}</p>
      </div>
    );
  }

  return (
    <div className="w-full">
      <Button
        id="back-to-projects-button"
        variant="soft"
        onClick={handleBack}
        className="mb-4"
      >
        <ArrowLeft className="h-4 w-4 mr-2" />
        {t('projects.backToProjects', 'Back to Projects')}
      </Button>

      <ProjectDetailView project={project} />
    </div>
  );
}
