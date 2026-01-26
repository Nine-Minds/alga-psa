'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { Button } from '@alga-psa/ui/components/Button';
import { FileText, ChevronRight, Check, Search, X, Zap } from 'lucide-react';
import { Input } from '@alga-psa/ui/components/Input';
import { Badge } from '@alga-psa/ui/components/Badge';
import LoadingIndicator from '@alga-psa/ui/components/LoadingIndicator';
import {
  ITicketTemplate,
  AppliedTemplateData
} from 'server/src/interfaces/ticketTemplate.interfaces';
import {
  getTicketTemplates,
  getTemplatesForBoard,
  applyTemplateToTicketForm
} from 'server/src/lib/actions/ticketTemplateActions';

interface TemplatePickerProps {
  /** Optional board ID to filter templates */
  boardId?: string;
  /** Callback when a template is selected */
  onSelectTemplate: (data: AppliedTemplateData, template: ITicketTemplate) => void;
  /** Callback when user chooses to skip template selection */
  onSkip: () => void;
  /** Currently selected template ID */
  selectedTemplateId?: string;
  /** Whether to show as inline picker or compact dropdown */
  variant?: 'inline' | 'compact';
  /** Additional class names */
  className?: string;
}

const CATEGORY_COLORS: Record<string, string> = {
  'Service Request': 'bg-blue-100 text-blue-800 border-blue-200',
  'Change': 'bg-purple-100 text-purple-800 border-purple-200',
  'Incident': 'bg-red-100 text-red-800 border-red-200',
  'Problem': 'bg-orange-100 text-orange-800 border-orange-200'
};

export function TemplatePicker({
  boardId,
  onSelectTemplate,
  onSkip,
  selectedTemplateId,
  variant = 'inline',
  className = ''
}: TemplatePickerProps) {
  const [templates, setTemplates] = useState<ITicketTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedType, setSelectedType] = useState<'all' | 'itil' | 'custom'>('all');
  const [applying, setApplying] = useState<string | null>(null);

  useEffect(() => {
    async function loadTemplates() {
      try {
        setLoading(true);
        setError(null);
        const data = boardId
          ? await getTemplatesForBoard(boardId)
          : await getTicketTemplates({ is_active: true });
        setTemplates(data);
      } catch (err) {
        console.error('Error loading templates:', err);
        setError(err instanceof Error ? err.message : 'Failed to load templates');
      } finally {
        setLoading(false);
      }
    }

    loadTemplates();
  }, [boardId]);

  const filteredTemplates = useMemo(() => {
    let filtered = templates;

    // Filter by type
    if (selectedType !== 'all') {
      filtered = filtered.filter(t => t.template_type === selectedType);
    }

    // Filter by search
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(t =>
        t.name.toLowerCase().includes(query) ||
        t.description?.toLowerCase().includes(query) ||
        t.itil_config?.itil_category?.toLowerCase().includes(query)
      );
    }

    return filtered;
  }, [templates, selectedType, searchQuery]);

  const handleSelectTemplate = async (template: ITicketTemplate) => {
    try {
      setApplying(template.template_id);
      const data = await applyTemplateToTicketForm(template.template_id);
      onSelectTemplate(data, template);
    } catch (err) {
      console.error('Error applying template:', err);
    } finally {
      setApplying(null);
    }
  };

  // Group templates by category for better organization
  const groupedTemplates = useMemo(() => {
    const groups: Record<string, ITicketTemplate[]> = {
      'ITIL': [],
      'Custom': []
    };

    filteredTemplates.forEach(template => {
      if (template.template_type === 'itil') {
        groups['ITIL'].push(template);
      } else {
        groups['Custom'].push(template);
      }
    });

    return groups;
  }, [filteredTemplates]);

  if (loading) {
    return (
      <div className={`flex items-center justify-center py-8 ${className}`}>
        <LoadingIndicator text="Loading templates..." />
      </div>
    );
  }

  if (error) {
    return (
      <div className={`text-center py-8 ${className}`}>
        <p className="text-red-600 text-sm mb-2">{error}</p>
        <Button id="skip-template-selection-error" variant="outline" size="sm" onClick={onSkip}>
          Skip Template Selection
        </Button>
      </div>
    );
  }

  if (templates.length === 0) {
    return (
      <div className={`text-center py-8 bg-gray-50 rounded-lg border border-dashed border-gray-300 ${className}`}>
        <FileText className="w-8 h-8 text-gray-400 mx-auto mb-2" />
        <p className="text-gray-600 text-sm mb-2">No templates available</p>
        <Button id="continue-without-template" variant="outline" size="sm" onClick={onSkip}>
          Continue Without Template
        </Button>
      </div>
    );
  }

  if (variant === 'compact') {
    return (
      <div className={`relative ${className}`}>
        <div className="flex items-center gap-2 p-3 bg-gray-50 rounded-lg border border-gray-200">
          <Zap className="w-4 h-4 text-primary-500" />
          <span className="text-sm text-gray-700">Quick start with a template:</span>
          <div className="flex gap-1 flex-wrap flex-1">
            {templates.slice(0, 3).map(template => (
              <Button
                key={template.template_id}
                id={`quick-template-${template.template_id}`}
                variant={selectedTemplateId === template.template_id ? 'default' : 'outline'}
                size="sm"
                onClick={() => handleSelectTemplate(template)}
                disabled={applying !== null}
              >
                {applying === template.template_id ? '...' : template.name}
              </Button>
            ))}
            {templates.length > 3 && (
              <Button
                id="view-all-templates"
                variant="ghost"
                size="sm"
                className="text-primary-600"
              >
                +{templates.length - 3} more
              </Button>
            )}
          </div>
          <Button
            id="skip-template-compact"
            variant="ghost"
            size="sm"
            onClick={onSkip}
            className="text-gray-500"
          >
            <X className="w-4 h-4" />
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className={`space-y-4 ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-medium text-gray-900">Choose a Template</h3>
          <p className="text-sm text-gray-500">
            Start with a pre-configured template or create from scratch
          </p>
        </div>
        <Button id="skip-template-selection" variant="ghost" onClick={onSkip}>
          Skip
          <ChevronRight className="w-4 h-4 ml-1" />
        </Button>
      </div>

      {/* Search & Filter */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <Input
            id="template-search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search templates..."
            className="pl-9"
            containerClassName="mb-0"
          />
        </div>
        <div className="flex gap-1">
          <Button
            id="filter-all-types"
            variant={selectedType === 'all' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setSelectedType('all')}
          >
            All
          </Button>
          <Button
            id="filter-itil-types"
            variant={selectedType === 'itil' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setSelectedType('itil')}
          >
            ITIL
          </Button>
          <Button
            id="filter-custom-types"
            variant={selectedType === 'custom' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setSelectedType('custom')}
          >
            Custom
          </Button>
        </div>
      </div>

      {/* Template Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 max-h-[400px] overflow-y-auto">
        {filteredTemplates.map((template) => {
          const isSelected = selectedTemplateId === template.template_id;
          const isApplying = applying === template.template_id;
          const categoryColor = template.itil_config?.itil_category
            ? CATEGORY_COLORS[template.itil_config.itil_category]
            : 'bg-gray-100 text-gray-800 border-gray-200';

          return (
            <button
              key={template.template_id}
              onClick={() => handleSelectTemplate(template)}
              disabled={applying !== null}
              className={`
                text-left p-4 rounded-lg border-2 transition-all
                ${isSelected
                  ? 'border-primary-500 bg-primary-50'
                  : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                }
                ${isApplying ? 'opacity-75' : ''}
                disabled:cursor-wait
              `}
            >
              <div className="flex items-start justify-between mb-2">
                <div className="flex items-center gap-2">
                  <FileText className="w-4 h-4 text-gray-400" />
                  <span className="font-medium text-gray-900">{template.name}</span>
                </div>
                {isSelected && (
                  <Check className="w-5 h-5 text-primary-500" />
                )}
              </div>

              {template.description && (
                <p className="text-sm text-gray-600 line-clamp-2 mb-2">
                  {template.description}
                </p>
              )}

              <div className="flex items-center gap-2">
                {template.template_type === 'itil' && template.itil_config?.itil_category && (
                  <Badge className={`text-xs ${categoryColor}`}>
                    {template.itil_config.itil_category}
                  </Badge>
                )}
                <Badge variant={template.template_type === 'itil' ? 'default' : 'outline'} className="text-xs">
                  {template.template_type === 'itil' ? 'ITIL' : 'Custom'}
                </Badge>
              </div>

              {isApplying && (
                <div className="mt-2 text-xs text-primary-600">
                  Applying template...
                </div>
              )}
            </button>
          );
        })}
      </div>

      {filteredTemplates.length === 0 && (
        <div className="text-center py-8 text-gray-500">
          <p className="text-sm">No templates match your search</p>
        </div>
      )}
    </div>
  );
}

export default TemplatePicker;
