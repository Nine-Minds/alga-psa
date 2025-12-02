'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { IProjectTemplateWithDetails } from 'server/src/interfaces/projectTemplate.interfaces';
import { getTemplateWithDetails } from 'server/src/lib/actions/project-actions/projectTemplateActions';
import TemplateEditor from 'server/src/components/projects/project-templates/TemplateEditor';

export default function TemplateDetailPage() {
  const params = useParams();
  const templateId = params?.templateId as string;

  const [template, setTemplate] = useState<IProjectTemplateWithDetails | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (templateId) {
      loadTemplate();
    }
  }, [templateId]);

  async function loadTemplate() {
    try {
      setLoading(true);
      const data = await getTemplateWithDetails(templateId);
      setTemplate(data);
    } catch (error) {
      console.error('Error loading template:', error);
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return <div className="p-6">Loading template...</div>;
  }

  if (!template) {
    return <div className="p-6">Template not found</div>;
  }

  return <TemplateEditor template={template} onTemplateUpdated={loadTemplate} />;
}
