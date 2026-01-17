'use client';

import React, { useState, useEffect } from 'react';
import { Dialog } from '@alga-psa/ui/components/Dialog';
import { Button } from '@alga-psa/ui/components/Button';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { Input } from '@alga-psa/ui/components/Input';
import { Checkbox } from '@alga-psa/ui/components/Checkbox';
import { Label } from '@alga-psa/ui/components/Label';
import { RadioGroup } from '@alga-psa/ui/components/RadioGroup';
import { DatePicker } from '@alga-psa/ui/components/DatePicker';
import { IProjectTemplate } from 'server/src/interfaces/projectTemplate.interfaces';
import { IClient } from 'server/src/interfaces/client.interfaces';
import { useToast } from 'server/src/hooks/use-toast';
import { useRouter } from 'next/navigation';
import { ClientPicker } from '@alga-psa/clients/components/clients/ClientPicker';
import { getTemplates, applyTemplate } from '../../actions/projectTemplateActions';
import { getAllClientsForProjects } from '../../actions/projectActions';

interface ApplyTemplateDialogProps {
  open: boolean;
  onClose: () => void;
  onSuccess?: (projectId: string) => void;
  initialTemplateId?: string;
}

type AssignmentOption = 'none' | 'primary' | 'all';

export function ApplyTemplateDialog({ open, onClose, onSuccess, initialTemplateId }: ApplyTemplateDialogProps) {
  const router = useRouter();
  const { toast } = useToast();
  const [templates, setTemplates] = useState<IProjectTemplate[]>([]);
  const [clients, setClients] = useState<IClient[]>([]);
  const [loading, setLoading] = useState(false);

  const [formData, setFormData] = useState({
    template_id: initialTemplateId || '',
    project_name: '',
    client_id: '',
    assigned_to: ''
  });
  const [startDate, setStartDate] = useState<Date | undefined>();

  const [options, setOptions] = useState({
    copyPhases: true,
    copyStatuses: true,
    copyTasks: true,
    copyChecklists: true,
    copyServices: true,
    assignmentOption: 'primary' as AssignmentOption
  });

  // Client picker filter states
  const [clientFilterState, setClientFilterState] = useState<'all' | 'active' | 'inactive'>('active');
  const [clientTypeFilter, setClientTypeFilter] = useState<'all' | 'company' | 'individual'>('all');

  useEffect(() => {
    if (open) {
      // Reset form state when dialog opens
      setFormData({
        template_id: initialTemplateId || '',
        project_name: '',
        client_id: '',
        assigned_to: ''
      });
      setStartDate(undefined);
      setOptions({
        copyPhases: true,
        copyStatuses: true,
        copyTasks: true,
        copyChecklists: true,
        copyServices: true,
        assignmentOption: 'primary'
      });
      loadData();
    }
  }, [open, initialTemplateId]);

  async function loadData() {
    try {
      const [templatesData, clientsData] = await Promise.all([
        getTemplates(),
        getAllClientsForProjects()
      ]);

      setTemplates(templatesData);
      setClients(clientsData);
    } catch (error) {
      console.error('[ApplyTemplateDialog] Failed to load data:', error);
      toast({
        title: 'Error',
        description: 'Failed to load data',
        variant: 'destructive'
      });
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!formData.template_id || !formData.project_name || !formData.client_id) {
      toast({
        title: 'Validation Error',
        description: 'Template, project name, and client are required',
        variant: 'destructive'
      });
      return;
    }

    try {
      setLoading(true);

      const projectId = await applyTemplate(formData.template_id, {
        project_name: formData.project_name,
        client_id: formData.client_id,
        start_date: startDate?.toISOString(),
        assigned_to: formData.assigned_to || undefined,
        options: {
          copyPhases: options.copyPhases,
          copyStatuses: options.copyStatuses,
          copyTasks: options.copyTasks,
          copyChecklists: options.copyChecklists,
          copyServices: options.copyServices,
          assignmentOption: options.assignmentOption
        }
      });

      toast({
        title: 'Success',
        description: 'Project created from template successfully'
      });

      onClose();
      if (onSuccess) {
        onSuccess(projectId);
      } else {
        router.push(`/msp/projects/${projectId}`);
      }
    } catch (error) {
      console.error('[ApplyTemplateDialog] Error:', error);
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to create project from template',
        variant: 'destructive'
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog isOpen={open} onClose={onClose} title="Create Project from Template" className="max-w-3xl" disableFocusTrap>
      <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <label className="block text-sm font-medium mb-2">
              Template *
            </label>
            <CustomSelect
              id="apply-template-select"
              value={formData.template_id}
              onValueChange={(value) => setFormData({ ...formData, template_id: value })}
              options={templates.map(t => ({
                value: t.template_id,
                label: t.template_name
              }))}
              placeholder="Select a template"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">
              Project Name *
            </label>
            <Input
              id="apply-template-project-name"
              value={formData.project_name}
              onChange={(e) => setFormData({ ...formData, project_name: e.target.value })}
              placeholder="Enter project name"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">
              Client *
            </label>
            <ClientPicker
              id="apply-template-client"
              clients={clients}
              selectedClientId={formData.client_id || null}
              onSelect={(clientId) => setFormData({ ...formData, client_id: clientId || '' })}
              filterState={clientFilterState}
              onFilterStateChange={setClientFilterState}
              clientTypeFilter={clientTypeFilter}
              onClientTypeFilterChange={setClientTypeFilter}
              placeholder="Select a client"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">
              Start Date (Optional)
            </label>
            <DatePicker
              id="apply-template-start-date"
              value={startDate}
              onChange={setStartDate}
              placeholder="Select start date"
              clearable
            />
          </div>

          {/* Customization Options Section */}
          <div className="border-t pt-6">
            <h3 className="text-lg font-semibold mb-4">Customization Options</h3>

            <div className="space-y-4">
              {/* Copy Options */}
              <div>
                <Label className="block text-sm font-medium mb-3">Template Elements to Copy</Label>
                <div className="space-y-2 ml-2">
                  <Checkbox
                    id="copy-phases-checkbox"
                    label="Copy Phases"
                    checked={options.copyPhases}
                    onChange={(e) => setOptions({ ...options, copyPhases: e.target.checked })}
                    containerClassName="mb-2"
                  />
                  <Checkbox
                    id="copy-statuses-checkbox"
                    label="Copy Statuses"
                    checked={options.copyStatuses}
                    onChange={(e) => setOptions({ ...options, copyStatuses: e.target.checked })}
                    containerClassName="mb-2"
                  />
                  <Checkbox
                    id="copy-tasks-checkbox"
                    label="Copy Tasks"
                    checked={options.copyTasks}
                    onChange={(e) => {
                      setOptions({
                        ...options,
                        copyTasks: e.target.checked,
                        // Disable checklists and services if tasks are disabled
                        copyChecklists: e.target.checked ? options.copyChecklists : false,
                        copyServices: e.target.checked ? options.copyServices : false
                      });
                    }}
                    containerClassName="mb-2"
                  />
                  <Checkbox
                    id="copy-checklists-checkbox"
                    label="Copy Checklists"
                    checked={options.copyChecklists}
                    disabled={!options.copyTasks}
                    onChange={(e) => setOptions({ ...options, copyChecklists: e.target.checked })}
                    containerClassName="mb-2"
                  />
                  <Checkbox
                    id="copy-services-checkbox"
                    label="Copy Task Services"
                    checked={options.copyServices}
                    disabled={!options.copyTasks}
                    onChange={(e) => setOptions({ ...options, copyServices: e.target.checked })}
                    containerClassName="mb-2"
                  />
                </div>
              </div>

              {/* Assignment Options */}
              <div>
                <Label className="block text-sm font-medium mb-3">Task Assignments</Label>
                <RadioGroup
                  id="task-assignment-option"
                  name="task-assignment-option"
                  value={options.assignmentOption}
                  onChange={(value) => setOptions({ ...options, assignmentOption: value as AssignmentOption })}
                  options={[
                    { value: 'none', label: "Don't copy assignments" },
                    { value: 'primary', label: 'Copy primary agent only' },
                    { value: 'all', label: 'Copy all agents (primary + additional)' },
                  ]}
                />
              </div>
            </div>
          </div>

          <div className="flex gap-4 justify-end pt-4 border-t">
            <Button
              id="apply-template-cancel"
              type="button"
              variant="outline"
              onClick={onClose}
            >
              Cancel
            </Button>
            <Button
              id="apply-template-submit"
              type="submit"
              disabled={loading}
            >
              {loading ? 'Creating...' : 'Create Project'}
            </Button>
          </div>
        </form>
    </Dialog>
  );
}
