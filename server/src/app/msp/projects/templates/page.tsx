'use client';

import { useState, useEffect } from 'react';
import { IProjectTemplate } from 'server/src/interfaces/projectTemplate.interfaces';
import { getTemplates, getTemplateCategories } from 'server/src/lib/actions/project-actions/projectTemplateActions';
import ProjectTemplatesList from 'server/src/components/projects/project-templates/ProjectTemplatesList';

export default function ProjectTemplatesPage() {
  const [templates, setTemplates] = useState<IProjectTemplate[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [templatesData, categoriesData] = await Promise.all([
          getTemplates(),
          getTemplateCategories()
        ]);

        setTemplates(templatesData);
        setCategories(categoriesData);
      } catch (error) {
        console.error('Error loading templates page:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  if (loading) {
    return <div>Loading...</div>;
  }

  return <ProjectTemplatesList initialTemplates={templates} initialCategories={categories} />;
}
