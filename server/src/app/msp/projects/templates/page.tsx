'use client';

import { useState, useEffect } from 'react';
import type { IProjectTemplate } from '@alga-psa/types';
import { getTemplates, getTemplateCategories } from '@alga-psa/projects/actions/projectTemplateActions';
import ProjectTemplatesList from '@alga-psa/projects/components/project-templates/ProjectTemplatesList';
import Spinner from '@alga-psa/ui/components/Spinner';

function TemplatesListSkeleton() {
  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex justify-between items-center mb-6">
        <div className="h-8 w-48 bg-gray-200 rounded animate-pulse" />
        <div className="flex gap-2">
          <div className="h-10 w-32 bg-gray-200 rounded animate-pulse" />
          <div className="h-10 w-40 bg-gray-200 rounded animate-pulse" />
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-4 mb-6">
        <div className="h-10 w-80 bg-gray-200 rounded animate-pulse" />
        <div className="h-10 w-64 bg-gray-200 rounded animate-pulse" />
      </div>

      {/* Table skeleton */}
      <div className="border rounded-lg overflow-hidden">
        {/* Table header */}
        <div className="bg-gray-50 border-b px-4 py-3 flex gap-4">
          <div className="h-4 w-32 bg-gray-300 rounded animate-pulse" />
          <div className="h-4 w-48 bg-gray-300 rounded animate-pulse flex-1" />
          <div className="h-4 w-24 bg-gray-300 rounded animate-pulse" />
          <div className="h-4 w-20 bg-gray-300 rounded animate-pulse" />
          <div className="h-4 w-24 bg-gray-300 rounded animate-pulse" />
          <div className="h-4 w-16 bg-gray-300 rounded animate-pulse" />
        </div>
        {/* Table rows */}
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="border-b px-4 py-4 flex gap-4 items-center">
            <div className="h-4 w-32 bg-gray-200 rounded animate-pulse" />
            <div className="h-4 w-48 bg-gray-100 rounded animate-pulse flex-1" />
            <div className="h-4 w-24 bg-gray-100 rounded animate-pulse" />
            <div className="h-4 w-20 bg-gray-100 rounded animate-pulse" />
            <div className="h-4 w-24 bg-gray-100 rounded animate-pulse" />
            <div className="h-8 w-8 bg-gray-100 rounded animate-pulse" />
          </div>
        ))}
      </div>

      {/* Pagination skeleton */}
      <div className="flex justify-between items-center mt-4">
        <div className="h-4 w-32 bg-gray-200 rounded animate-pulse" />
        <div className="flex gap-2">
          <div className="h-8 w-20 bg-gray-200 rounded animate-pulse" />
          <div className="h-8 w-8 bg-gray-200 rounded animate-pulse" />
          <div className="h-8 w-8 bg-gray-200 rounded animate-pulse" />
          <div className="h-8 w-20 bg-gray-200 rounded animate-pulse" />
        </div>
      </div>
    </div>
  );
}

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
    return (
      <div className="relative">
        <TemplatesListSkeleton />
        <div className="absolute inset-0 flex items-center justify-center bg-white/50">
          <Spinner size="lg" />
        </div>
      </div>
    );
  }

  return <ProjectTemplatesList initialTemplates={templates} initialCategories={categories} />;
}
