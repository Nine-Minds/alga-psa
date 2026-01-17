'use client';

import React, { useState, useEffect } from 'react';
import { Card } from '@alga-psa/ui/components/Card';
import { Button } from '@alga-psa/ui/components/Button';
import { LayoutTemplate, Search, Filter } from 'lucide-react';
import { Input } from '@alga-psa/ui/components/Input';
import { getAllTemplates, TemplateData } from 'server/src/lib/actions/template-library-actions';
import TemplatePreview from 'server/src/components/template-library/TemplatePreview';
import { Skeleton } from '@alga-psa/ui/components/Skeleton';
import { toast } from 'react-hot-toast';

export default function TemplateLibrary() {
  const [templates, setTemplates] = useState<TemplateData[]>([]);
  const [filteredTemplates, setFilteredTemplates] = useState<TemplateData[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [categories, setCategories] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [templatesDisabled, setTemplatesDisabled] = useState(true); // Disable template cards initially
  
  // Template preview state
  const [previewTemplate, setPreviewTemplate] = useState<TemplateData | null>(null);
  const [previewMode, setPreviewMode] = useState<'preview' | 'create'>('preview');
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);

  // Load templates
  useEffect(() => {
    const loadTemplates = async () => {
      try {
        setIsLoading(true);
        const data = await getAllTemplates();
        setTemplates(data);
        setFilteredTemplates(data);
        
        // Extract unique categories
        const uniqueCategories = Array.from(
          new Set(data.map(template => template.category).filter(Boolean))
        ) as string[];
        
        setCategories(uniqueCategories);
      } catch (error) {
        console.error('Error loading templates:', error);
        toast.error('Failed to load templates');
      } finally {
        setIsLoading(false);
      }
    };

    loadTemplates();
  }, []);

  // Filter templates based on search query and category
  useEffect(() => {
    let filtered = templates;
    
    // Filter by search query
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(
        template =>
          template.name.toLowerCase().includes(query) ||
          (template.description && template.description.toLowerCase().includes(query)) ||
          (template.tags && template.tags.some(tag => tag.toLowerCase().includes(query)))
      );
    }
    
    // Filter by category
    if (selectedCategory) {
      filtered = filtered.filter(template => template.category === selectedCategory);
    }
    
    setFilteredTemplates(filtered);
  }, [searchQuery, selectedCategory, templates]);

  // Handle template preview
  const handlePreview = (template: TemplateData) => {
    setPreviewTemplate(template);
    setPreviewMode('preview');
    setIsPreviewOpen(true);
  };

  // Handle use template
  const handleUseTemplate = (template: TemplateData) => {
    setPreviewTemplate(template);
    setPreviewMode('create');
    setIsPreviewOpen(true);
  };

  // Close preview
  const handleClosePreview = () => {
    setIsPreviewOpen(false);
  };

  return (
    <div className="space-y-6">
      <Card className="p-6">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center">
            <LayoutTemplate className="h-6 w-6 text-primary-500 mr-2" />
            <h1 className="text-xl font-semibold">Template Library</h1>
          </div>
          <div className="flex items-center space-x-4">
            <div className="relative w-64">
              <Search className="absolute left-2 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
              <Input
                id="search-templates-input"
                placeholder="Search templates..."
                className="pl-8"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            
            {categories.length > 0 && (
              <div className="flex items-center space-x-2">
                <Filter className="h-4 w-4 text-gray-500" />
                <select
                  id="category-filter"
                  className="text-sm border border-gray-300 rounded-md p-1"
                  value={selectedCategory || ''}
                  onChange={(e) => setSelectedCategory(e.target.value || null)}
                >
                  <option value="">All Categories</option>
                  {categories.map((category) => (
                    <option key={category} value={category}>
                      {category}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
        </div>
        
        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <Card key={i} className="p-4 border border-gray-200">
                <Skeleton className="h-6 w-3/4 mb-2" />
                <Skeleton className="h-4 w-full mb-3" />
                <Skeleton className="h-4 w-1/4 mb-3" />
                <Skeleton className="h-4 w-1/2 mb-4" />
                <div className="flex space-x-2">
                  <Skeleton className="h-8 w-20" />
                  <Skeleton className="h-8 w-24" />
                </div>
              </Card>
            ))}
          </div>
        ) : filteredTemplates.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-gray-500">No templates found matching your criteria.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredTemplates.map((template) => (
              <Card key={template.template_id} className={`p-4 border border-gray-200 relative ${templatesDisabled ? 'opacity-50 cursor-not-allowed' : ''}`}>
                {templatesDisabled && (
                  <div className="absolute inset-0 flex items-center justify-center bg-white bg-opacity-75 z-10 rounded-md">
                    <p className="text-lg font-semibold text-gray-800">Coming Soon</p>
                  </div>
                )}
                <div className={`${templatesDisabled ? 'pointer-events-none' : ''}`}>
                  <h3 className="text-lg font-medium mb-2">{template.name}</h3>
                  <p className="text-gray-600 text-sm mb-3">{template.description}</p>
                  {template.category && (
                    <div className="flex items-center mb-3">
                      <span className="text-xs font-medium bg-primary-100 text-primary-800 rounded-full px-2 py-1">
                        {template.category}
                      </span>
                    </div>
                  )}
                  {template.tags && template.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1 mb-4">
                      {template.tags.map((tag) => (
                        <span key={tag} className="text-xs bg-gray-100 text-gray-800 rounded-full px-2 py-0.5">
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}
                  <div className="flex space-x-2 mt-auto">
                    <Button
                      id={`preview-${template.template_id}-button`}
                      variant="outline"
                      size="sm"
                      onClick={() => handlePreview(template)}
                      disabled={templatesDisabled} // Disable button
                    >
                      Preview
                    </Button>
                    <Button
                      id={`use-${template.template_id}-button`}
                      size="sm"
                      onClick={() => handleUseTemplate(template)}
                      disabled={templatesDisabled} // Disable button
                    >
                      Use Template
                    </Button>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </Card>
      
      {/* Template Preview Dialog */}
      <TemplatePreview
        isOpen={isPreviewOpen}
        onClose={handleClosePreview}
        template={previewTemplate}
        mode={previewMode}
      />
    </div>
  );
}