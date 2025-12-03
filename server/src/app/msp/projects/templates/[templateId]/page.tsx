'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { IProjectTemplateWithDetails } from 'server/src/interfaces/projectTemplate.interfaces';
import { getTemplateWithDetails } from 'server/src/lib/actions/project-actions/projectTemplateActions';
import TemplateEditor from 'server/src/components/projects/project-templates/TemplateEditor';
import Spinner from 'server/src/components/ui/Spinner';
import { Card } from 'server/src/components/ui/Card';
import KanbanBoardSkeleton from 'server/src/components/ui/skeletons/KanbanBoardSkeleton';

function TemplateEditorSkeleton() {
  return (
    <div className="h-full flex flex-col">
      {/* Header skeleton */}
      <div className="border-b px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="h-9 w-20 bg-gray-200 rounded animate-pulse" />
            <div className="flex items-center gap-3">
              <div className="h-7 w-24 bg-purple-100 rounded-full animate-pulse" />
              <div className="h-8 w-48 bg-gray-200 rounded animate-pulse" />
            </div>
          </div>
          <div className="flex gap-2">
            <div className="h-9 w-32 bg-gray-200 rounded animate-pulse" />
            <div className="h-9 w-28 bg-gray-200 rounded animate-pulse" />
            <div className="h-9 w-24 bg-gray-200 rounded animate-pulse" />
          </div>
        </div>
        <div className="mt-4 flex gap-6">
          <div className="h-4 w-64 bg-gray-200 rounded animate-pulse" />
          <div className="h-4 w-32 bg-gray-200 rounded animate-pulse" />
        </div>
      </div>

      {/* Main content skeleton */}
      <div className="flex-1 flex p-4 gap-4">
        {/* Left sidebar - Phases */}
        <div className="w-64 flex-shrink-0">
          <Card className="p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="h-5 w-28 bg-gray-200 rounded animate-pulse" />
              <div className="h-8 w-8 bg-gray-200 rounded animate-pulse" />
            </div>
            <div className="space-y-2">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-10 bg-gray-100 rounded animate-pulse" />
              ))}
            </div>
          </Card>
        </div>

        {/* Main content - Kanban board skeleton */}
        <div className="flex-1 overflow-x-auto">
          <KanbanBoardSkeleton />
        </div>
      </div>
    </div>
  );
}

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
    return (
      <div className="h-full relative">
        <TemplateEditorSkeleton />
        <div className="absolute inset-0 flex items-center justify-center bg-white/50">
          <Spinner size="lg" />
        </div>
      </div>
    );
  }

  if (!template) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-6">
        <div className="text-gray-400 mb-2">
          <svg className="h-16 w-16" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
        </div>
        <h2 className="text-xl font-semibold text-gray-700 mb-1">Template not found</h2>
        <p className="text-gray-500">The template you're looking for doesn't exist or has been deleted.</p>
      </div>
    );
  }

  return <TemplateEditor template={template} onTemplateUpdated={loadTemplate} />;
}
