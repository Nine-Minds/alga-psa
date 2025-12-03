'use client';

import { useState, useEffect } from 'react';
import { IProject } from 'server/src/interfaces/project.interfaces';
import { getProjects } from 'server/src/lib/actions/project-actions/projectActions';
import { getTemplateCategories } from 'server/src/lib/actions/project-actions/projectTemplateActions';
import CreateTemplateForm from 'server/src/components/projects/project-templates/CreateTemplateForm';

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
