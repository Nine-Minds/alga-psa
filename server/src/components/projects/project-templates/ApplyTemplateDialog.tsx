'use client';

import React, { useState, useEffect } from 'react';
import { Dialog } from '@/components/ui/Dialog';
import { Button } from '@/components/ui/Button';
import CustomSelect from '@/components/ui/CustomSelect';
import { Input } from '@/components/ui/Input';
import { IProjectTemplate } from '@/interfaces/projectTemplate.interfaces';
import { IClient } from '@/interfaces/client.interfaces';
import { useToast } from 'server/src/hooks/use-toast';
import { useRouter } from 'next/navigation';

interface ApplyTemplateDialogProps {
  open: boolean;
  onClose: () => void;
  onSuccess?: (projectId: string) => void;
}

export function ApplyTemplateDialog({ open, onClose, onSuccess }: ApplyTemplateDialogProps) {
  const router = useRouter();
  const { toast } = useToast();
  const [templates, setTemplates] = useState<IProjectTemplate[]>([]);
  const [clients, setClients] = useState<IClient[]>([]);
  const [loading, setLoading] = useState(false);

  const [formData, setFormData] = useState({
    template_id: '',
    project_name: '',
    client_id: '',
    start_date: '',
    assigned_to: ''
  });

  useEffect(() => {
    if (open) {
      loadData();
    }
  }, [open]);

  async function loadData() {
    try {
      const [templatesRes, clientsRes] = await Promise.all([
        fetch('/api/projects/templates'),
        fetch('/api/clients')
      ]);

      if (!templatesRes.ok || !clientsRes.ok) {
        throw new Error('Failed to fetch data');
      }

      const templatesData = await templatesRes.json();
      const clientsData = await clientsRes.json();

      setTemplates(templatesData);
      setClients(clientsData);
    } catch (error) {
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

      const response = await fetch(`/api/projects/templates/${formData.template_id}/apply`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          project_name: formData.project_name,
          client_id: formData.client_id,
          start_date: formData.start_date || undefined,
          assigned_to: formData.assigned_to || undefined
        })
      });

      if (!response.ok) {
        throw new Error('Failed to create project from template');
      }

      const { project_id } = await response.json();

      toast({
        title: 'Success',
        description: 'Project created from template successfully'
      });

      onClose();
      if (onSuccess) {
        onSuccess(project_id);
      } else {
        router.push(`/msp/projects/${project_id}`);
      }
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to create project from template',
        variant: 'destructive'
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog isOpen={open} onClose={onClose} title="Create Project from Template" className="max-w-2xl">
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
            <CustomSelect
              id="apply-template-client"
              value={formData.client_id}
              onValueChange={(value) => setFormData({ ...formData, client_id: value })}
              options={clients.map(c => ({
                value: c.client_id,
                label: c.client_name
              }))}
              placeholder="Select a client"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">
              Start Date (Optional)
            </label>
            <Input
              id="apply-template-start-date"
              type="date"
              value={formData.start_date}
              onChange={(e) => setFormData({ ...formData, start_date: e.target.value })}
            />
          </div>

          <div className="flex gap-4 justify-end">
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
