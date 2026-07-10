'use client';

import { useState, useEffect } from 'react';
import type { IProject } from '@alga-psa/types';
import { getProjects } from '@alga-psa/projects/actions/projectActions';
import { getTemplateCategories } from '@alga-psa/projects/actions/projectTemplateActions';
import CreateTemplateForm from '@alga-psa/projects/components/project-templates/CreateTemplateForm';
import {
  getErrorMessage,
  handleError,
  isActionMessageError,
  isActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';

function isReturnedActionError(value: unknown): value is { actionError: string } | { permissionError: string } {
  return isActionMessageError(value) || isActionPermissionError(value);
}

export default function CreateTemplatePage() {
  const [projects, setProjects] = useState<IProject[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [projectsData, categoriesData] = await Promise.all([
          getProjects(),
          getTemplateCategories()
        ]);

        if (isActionPermissionError(projectsData)) {
          handleError(projectsData.permissionError);
          return;
        }
        if (isReturnedActionError(categoriesData)) {
          handleError(getErrorMessage(categoriesData));
          return;
        }
        setProjects(projectsData);
        setCategories(categoriesData);
      } catch (error) {
        console.error('Error loading create template page:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  if (loading) {
    return <div>Loading...</div>;
  }

  return <CreateTemplateForm projects={projects} categories={categories} />;
}
