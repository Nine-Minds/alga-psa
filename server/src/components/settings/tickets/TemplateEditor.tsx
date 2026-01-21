'use client';

import React, { useState, useEffect } from 'react';
import { Button } from 'server/src/components/ui/Button';
import { Input } from 'server/src/components/ui/Input';
import { TextArea } from 'server/src/components/ui/TextArea';
import { Switch } from 'server/src/components/ui/Switch';
import CustomSelect from 'server/src/components/ui/CustomSelect';
import { Tabs, TabsList, TabsTrigger, TabsContent } from 'server/src/components/ui/Tabs';
import { Plus, Trash2, GripVertical } from 'lucide-react';
import { toast } from 'react-hot-toast';
import {
  ITicketTemplate,
  CreateTicketTemplateInput,
  UpdateTicketTemplateInput,
  TicketDefaultValues,
  ITILTemplateConfig
} from 'server/src/interfaces/ticketTemplate.interfaces';
import {
  createTicketTemplate,
  updateTicketTemplate
} from 'server/src/lib/actions/ticketTemplateActions';

interface TemplateEditorProps {
  template: ITicketTemplate | null;
  onSave: () => void;
  onCancel: () => void;
}

const TEMPLATE_TYPES = [
  { value: 'custom', label: 'Custom Template' },
  { value: 'itil', label: 'ITIL Template' }
];

const ITIL_CATEGORIES = [
  { value: 'Incident', label: 'Incident' },
  { value: 'Service Request', label: 'Service Request' },
  { value: 'Change', label: 'Change' },
  { value: 'Problem', label: 'Problem' }
];

const IMPACT_LEVELS = [
  { value: '1', label: '1 - Critical (Organization-wide)' },
  { value: '2', label: '2 - High (Multiple departments)' },
  { value: '3', label: '3 - Medium (Single department)' },
  { value: '4', label: '4 - Low (Group of users)' },
  { value: '5', label: '5 - Minimal (Single user)' }
];

const URGENCY_LEVELS = [
  { value: '1', label: '1 - Critical (Immediate)' },
  { value: '2', label: '2 - High (Within hours)' },
  { value: '3', label: '3 - Medium (Within days)' },
  { value: '4', label: '4 - Low (Within weeks)' },
  { value: '5', label: '5 - Minimal (When possible)' }
];

export function TemplateEditor({ template, onSave, onCancel }: TemplateEditorProps) {
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState('general');

  // Form state
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [templateType, setTemplateType] = useState<'itil' | 'custom'>('custom');

  // Default values
  const [defaultTitle, setDefaultTitle] = useState('');
  const [defaultDescription, setDefaultDescription] = useState('');
  const [defaultImpact, setDefaultImpact] = useState<string>('3');
  const [defaultUrgency, setDefaultUrgency] = useState<string>('3');

  // ITIL config
  const [itilCategory, setItilCategory] = useState<string>('Service Request');
  const [checklistItems, setChecklistItems] = useState<string[]>([]);
  const [suggestedSteps, setSuggestedSteps] = useState<string[]>([]);

  // Initialize form with template data
  useEffect(() => {
    if (template) {
      setName(template.name);
      setDescription(template.description || '');
      setTemplateType(template.template_type);
      setDefaultTitle(template.default_values.title || '');
      setDefaultDescription(template.default_values.description || '');
      setDefaultImpact(String(template.default_values.itil_impact || 3));
      setDefaultUrgency(String(template.default_values.itil_urgency || 3));

      if (template.itil_config) {
        setItilCategory(template.itil_config.itil_category || 'Service Request');
        setChecklistItems(template.itil_config.checklist_items || []);
        setSuggestedSteps(template.itil_config.suggested_resolution_steps || []);
      }
    } else {
      // Reset to defaults for new template
      setName('');
      setDescription('');
      setTemplateType('custom');
      setDefaultTitle('');
      setDefaultDescription('');
      setDefaultImpact('3');
      setDefaultUrgency('3');
      setItilCategory('Service Request');
      setChecklistItems([]);
      setSuggestedSteps([]);
    }
  }, [template]);

  const handleSave = async () => {
    if (!name.trim()) {
      toast.error('Template name is required');
      return;
    }

    setSaving(true);

    try {
      const defaultValues: TicketDefaultValues = {
        title: defaultTitle || undefined,
        description: defaultDescription || undefined,
        itil_impact: parseInt(defaultImpact),
        itil_urgency: parseInt(defaultUrgency)
      };

      const itilConfig: ITILTemplateConfig | null = templateType === 'itil' ? {
        default_impact: parseInt(defaultImpact),
        default_urgency: parseInt(defaultUrgency),
        checklist_items: checklistItems.filter(item => item.trim()),
        suggested_resolution_steps: suggestedSteps.filter(step => step.trim()),
        itil_category: itilCategory
      } : null;

      if (template) {
        // Update existing
        const input: UpdateTicketTemplateInput = {
          name: name.trim(),
          description: description.trim() || undefined,
          template_type: templateType,
          default_values: defaultValues,
          itil_config: itilConfig
        };
        await updateTicketTemplate(template.template_id, input);
        toast.success('Template updated');
      } else {
        // Create new
        const input: CreateTicketTemplateInput = {
          name: name.trim(),
          description: description.trim() || undefined,
          template_type: templateType,
          default_values: defaultValues,
          itil_config: itilConfig
        };
        await createTicketTemplate(input);
        toast.success('Template created');
      }

      onSave();
    } catch (err) {
      console.error('Error saving template:', err);
      toast.error(err instanceof Error ? err.message : 'Failed to save template');
    } finally {
      setSaving(false);
    }
  };

  const addChecklistItem = () => {
    setChecklistItems([...checklistItems, '']);
  };

  const updateChecklistItem = (index: number, value: string) => {
    const newItems = [...checklistItems];
    newItems[index] = value;
    setChecklistItems(newItems);
  };

  const removeChecklistItem = (index: number) => {
    setChecklistItems(checklistItems.filter((_, i) => i !== index));
  };

  const addSuggestedStep = () => {
    setSuggestedSteps([...suggestedSteps, '']);
  };

  const updateSuggestedStep = (index: number, value: string) => {
    const newSteps = [...suggestedSteps];
    newSteps[index] = value;
    setSuggestedSteps(newSteps);
  };

  const removeSuggestedStep = (index: number) => {
    setSuggestedSteps(suggestedSteps.filter((_, i) => i !== index));
  };

  return (
    <div className="space-y-6">
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="general">General</TabsTrigger>
          <TabsTrigger value="defaults">Default Values</TabsTrigger>
          {templateType === 'itil' && (
            <TabsTrigger value="itil">ITIL Configuration</TabsTrigger>
          )}
        </TabsList>

        {/* General Tab */}
        <TabsContent value="general" className="space-y-4 mt-4">
          <div>
            <label htmlFor="template-name" className="block text-sm font-medium text-gray-700 mb-1">
              Template Name <span className="text-red-500">*</span>
            </label>
            <Input
              id="template-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., New Hire Onboarding"
            />
          </div>

          <div>
            <label htmlFor="template-description" className="block text-sm font-medium text-gray-700 mb-1">
              Description
            </label>
            <TextArea
              id="template-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe when to use this template..."
              rows={3}
            />
          </div>

          <div>
            <label htmlFor="template-type" className="block text-sm font-medium text-gray-700 mb-1">
              Template Type
            </label>
            <CustomSelect
              options={TEMPLATE_TYPES}
              value={templateType}
              onValueChange={(value) => setTemplateType(value as 'itil' | 'custom')}
              placeholder="Select type"
            />
            <p className="mt-1 text-xs text-gray-500">
              ITIL templates include impact/urgency settings and workflow configurations
            </p>
          </div>
        </TabsContent>

        {/* Default Values Tab */}
        <TabsContent value="defaults" className="space-y-4 mt-4">
          <div>
            <label htmlFor="default-title" className="block text-sm font-medium text-gray-700 mb-1">
              Default Title
            </label>
            <Input
              id="default-title"
              value={defaultTitle}
              onChange={(e) => setDefaultTitle(e.target.value)}
              placeholder="e.g., New Hire Onboarding: [Employee Name]"
            />
            <p className="mt-1 text-xs text-gray-500">
              Use [brackets] for placeholders the user should fill in
            </p>
          </div>

          <div>
            <label htmlFor="default-description" className="block text-sm font-medium text-gray-700 mb-1">
              Default Description
            </label>
            <TextArea
              id="default-description"
              value={defaultDescription}
              onChange={(e) => setDefaultDescription(e.target.value)}
              placeholder="Pre-fill ticket description with instructions, checklists, etc."
              rows={8}
              className="font-mono text-sm"
            />
            <p className="mt-1 text-xs text-gray-500">
              Supports Markdown formatting. Use - [ ] for checklists.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="default-impact" className="block text-sm font-medium text-gray-700 mb-1">
                Default Impact
              </label>
              <CustomSelect
                options={IMPACT_LEVELS}
                value={defaultImpact}
                onValueChange={setDefaultImpact}
                placeholder="Select impact"
              />
            </div>

            <div>
              <label htmlFor="default-urgency" className="block text-sm font-medium text-gray-700 mb-1">
                Default Urgency
              </label>
              <CustomSelect
                options={URGENCY_LEVELS}
                value={defaultUrgency}
                onValueChange={setDefaultUrgency}
                placeholder="Select urgency"
              />
            </div>
          </div>

          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <h4 className="text-sm font-medium text-blue-800 mb-2">Priority Matrix</h4>
            <p className="text-sm text-blue-700">
              Priority = Impact × Urgency
            </p>
            <p className="text-sm text-blue-600 mt-1">
              Current: Impact {defaultImpact} × Urgency {defaultUrgency} = Priority{' '}
              <strong>{parseInt(defaultImpact) * parseInt(defaultUrgency)}</strong>
            </p>
          </div>
        </TabsContent>

        {/* ITIL Configuration Tab */}
        {templateType === 'itil' && (
          <TabsContent value="itil" className="space-y-4 mt-4">
            <div>
              <label htmlFor="itil-category" className="block text-sm font-medium text-gray-700 mb-1">
                ITIL Category
              </label>
              <CustomSelect
                options={ITIL_CATEGORIES}
                value={itilCategory}
                onValueChange={setItilCategory}
                placeholder="Select category"
              />
            </div>

            {/* Checklist Items */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="block text-sm font-medium text-gray-700">
                  Checklist Items
                </label>
                <Button
                  id="add-checklist-item"
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={addChecklistItem}
                >
                  <Plus className="w-4 h-4 mr-1" />
                  Add Item
                </Button>
              </div>
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {checklistItems.map((item, index) => (
                  <div key={index} className="flex items-center gap-2">
                    <GripVertical className="w-4 h-4 text-gray-400" />
                    <Input
                      id={`checklist-item-${index}`}
                      value={item}
                      onChange={(e) => updateChecklistItem(index, e.target.value)}
                      placeholder="Checklist item..."
                      containerClassName="flex-1 mb-0"
                    />
                    <Button
                      id={`remove-checklist-item-${index}`}
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => removeChecklistItem(index)}
                      className="text-red-500 hover:text-red-700"
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                ))}
                {checklistItems.length === 0 && (
                  <p className="text-sm text-gray-500 italic">No checklist items yet</p>
                )}
              </div>
            </div>

            {/* Suggested Resolution Steps */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="block text-sm font-medium text-gray-700">
                  Suggested Resolution Steps
                </label>
                <Button
                  id="add-resolution-step"
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={addSuggestedStep}
                >
                  <Plus className="w-4 h-4 mr-1" />
                  Add Step
                </Button>
              </div>
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {suggestedSteps.map((step, index) => (
                  <div key={index} className="flex items-center gap-2">
                    <span className="text-sm font-medium text-gray-500 w-6">
                      {index + 1}.
                    </span>
                    <Input
                      id={`resolution-step-${index}`}
                      value={step}
                      onChange={(e) => updateSuggestedStep(index, e.target.value)}
                      placeholder="Resolution step..."
                      containerClassName="flex-1 mb-0"
                    />
                    <Button
                      id={`remove-resolution-step-${index}`}
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => removeSuggestedStep(index)}
                      className="text-red-500 hover:text-red-700"
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                ))}
                {suggestedSteps.length === 0 && (
                  <p className="text-sm text-gray-500 italic">No resolution steps yet</p>
                )}
              </div>
            </div>
          </TabsContent>
        )}
      </Tabs>

      {/* Actions */}
      <div className="flex justify-end gap-2 pt-4 border-t">
        <Button id="cancel-template-edit" variant="outline" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
        <Button id="save-template" onClick={handleSave} disabled={saving}>
          {saving ? 'Saving...' : template ? 'Update Template' : 'Create Template'}
        </Button>
      </div>
    </div>
  );
}

export default TemplateEditor;
