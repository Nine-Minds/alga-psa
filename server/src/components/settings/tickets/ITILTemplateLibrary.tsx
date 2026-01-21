'use client';

import React, { useState } from 'react';
import { Button } from 'server/src/components/ui/Button';
import { Download, UserPlus, UserMinus, GitBranch, AlertTriangle, Search, Check, KeyRound, Package, Monitor } from 'lucide-react';
import { Badge } from 'server/src/components/ui/Badge';
import { toast } from 'react-hot-toast';
import { seedITILTemplates } from 'server/src/lib/actions/ticketTemplateActions';

interface ITILTemplateLibraryProps {
  onImport: () => void;
  onClose: () => void;
}

interface ITILTemplatePreview {
  name: string;
  description: string;
  category: string;
  icon: React.ReactNode;
  defaultFields: string[];
}

const ITIL_TEMPLATES: ITILTemplatePreview[] = [
  {
    name: 'New Hire Onboarding',
    description: 'Standard process for setting up a new employee with equipment, accounts, and access.',
    category: 'Service Request',
    icon: <UserPlus className="w-5 h-5" />,
    defaultFields: ['Employee Name', 'Start Date', 'Department', 'Equipment Type']
  },
  {
    name: 'Employee Offboarding',
    description: 'Standard process for revoking access and collecting equipment when an employee leaves.',
    category: 'Service Request',
    icon: <UserMinus className="w-5 h-5" />,
    defaultFields: ['Employee Name', 'Last Working Day', 'Offboarding Type']
  },
  {
    name: 'Change Request',
    description: 'ITIL standard change request for infrastructure or application modifications.',
    category: 'Change',
    icon: <GitBranch className="w-5 h-5" />,
    defaultFields: ['Change Type', 'Risk Level', 'Planned Start Date', 'CAB Approval']
  },
  {
    name: 'Incident Report',
    description: 'ITIL incident management for service disruptions or degradation.',
    category: 'Incident',
    icon: <AlertTriangle className="w-5 h-5" />,
    defaultFields: ['Affected System', 'Number of Users Affected', 'Service Restored']
  },
  {
    name: 'Problem Investigation',
    description: 'ITIL problem management for investigating root causes of recurring incidents.',
    category: 'Problem',
    icon: <Search className="w-5 h-5" />,
    defaultFields: ['Root Cause Category', 'Known Error', 'Permanent Fix Implemented']
  },
  {
    name: 'Password Reset Request',
    description: 'Standard service request for password resets.',
    category: 'Service Request',
    icon: <KeyRound className="w-5 h-5" />,
    defaultFields: ['System', 'Verification Method']
  },
  {
    name: 'Software Installation Request',
    description: 'Request for software installation or license assignment.',
    category: 'Service Request',
    icon: <Package className="w-5 h-5" />,
    defaultFields: ['Software Name', 'License Type', 'Manager Approved']
  },
  {
    name: 'Hardware Request',
    description: 'Request for new hardware or equipment.',
    category: 'Service Request',
    icon: <Monitor className="w-5 h-5" />,
    defaultFields: ['Equipment Type', 'Urgency', 'Budget Code']
  }
];

const CATEGORY_COLORS: Record<string, string> = {
  'Service Request': 'bg-blue-100 text-blue-800',
  'Change': 'bg-purple-100 text-purple-800',
  'Incident': 'bg-red-100 text-red-800',
  'Problem': 'bg-orange-100 text-orange-800'
};

export function ITILTemplateLibrary({ onImport, onClose }: ITILTemplateLibraryProps) {
  const [importing, setImporting] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);

  const handleImportAll = async () => {
    setImporting(true);
    try {
      const result = await seedITILTemplates();
      if (result.created > 0) {
        toast.success(`Imported ${result.created} ITIL templates`);
        onImport();
      } else if (result.skipped > 0) {
        toast.success('All ITIL templates are already imported');
        onClose();
      }
    } catch (err) {
      console.error('Error importing templates:', err);
      toast.error(err instanceof Error ? err.message : 'Failed to import templates');
    } finally {
      setImporting(false);
    }
  };

  const filteredTemplates = selectedCategory
    ? ITIL_TEMPLATES.filter(t => t.category === selectedCategory)
    : ITIL_TEMPLATES;

  const categories = Array.from(new Set(ITIL_TEMPLATES.map(t => t.category)));

  return (
    <div className="space-y-6">
      {/* Description */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <h3 className="text-sm font-medium text-blue-800 mb-2">About ITIL Templates</h3>
        <p className="text-sm text-blue-700">
          ITIL (Information Technology Infrastructure Library) templates provide standardized workflows
          for common IT service management scenarios. These templates include default values, checklists,
          and suggested resolution steps based on ITIL best practices.
        </p>
      </div>

      {/* Category Filter */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-sm text-gray-600">Filter by category:</span>
        <Button
          id="filter-all-categories"
          variant={selectedCategory === null ? 'default' : 'outline'}
          size="sm"
          onClick={() => setSelectedCategory(null)}
        >
          All
        </Button>
        {categories.map(category => (
          <Button
            key={category}
            id={`filter-category-${category.toLowerCase().replace(' ', '-')}`}
            variant={selectedCategory === category ? 'default' : 'outline'}
            size="sm"
            onClick={() => setSelectedCategory(category)}
          >
            {category}
          </Button>
        ))}
      </div>

      {/* Template Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-h-[400px] overflow-y-auto">
        {filteredTemplates.map((template) => (
          <div
            key={template.name}
            className="border border-gray-200 rounded-lg p-4 hover:border-primary-300 hover:shadow-sm transition-all"
          >
            <div className="flex items-start gap-3">
              <div className="p-2 bg-gray-100 rounded-lg text-gray-600">
                {template.icon}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <h4 className="font-medium text-gray-900">{template.name}</h4>
                </div>
                <Badge className={CATEGORY_COLORS[template.category] || 'bg-gray-100 text-gray-800'}>
                  {template.category}
                </Badge>
                <p className="text-sm text-gray-600 mt-2 line-clamp-2">
                  {template.description}
                </p>
                <div className="mt-3">
                  <p className="text-xs text-gray-500 mb-1">Includes fields:</p>
                  <div className="flex flex-wrap gap-1">
                    {template.defaultFields.map(field => (
                      <span
                        key={field}
                        className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded"
                      >
                        {field}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Actions */}
      <div className="flex items-center justify-between pt-4 border-t">
        <div className="text-sm text-gray-500">
          {ITIL_TEMPLATES.length} templates available
        </div>
        <div className="flex items-center gap-2">
          <Button id="close-itil-library" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button id="import-all-itil" onClick={handleImportAll} disabled={importing}>
            {importing ? (
              <>Importing...</>
            ) : (
              <>
                <Download className="w-4 h-4 mr-2" />
                Import All Templates
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}

export default ITILTemplateLibrary;
