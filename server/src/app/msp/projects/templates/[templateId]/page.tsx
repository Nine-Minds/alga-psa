'use client';

import React, { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Edit, Trash, Copy, ArrowLeft } from 'lucide-react';
import { IProjectTemplateWithDetails } from '@/interfaces/projectTemplate.interfaces';
import { useToast } from 'server/src/hooks/use-toast';

export default function TemplateDetailPage() {
  const router = useRouter();
  const params = useParams();
  const { toast } = useToast();
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
      const response = await fetch(`/api/projects/templates/${templateId}`);

      if (!response.ok) {
        throw new Error('Failed to fetch template');
      }

      const data = await response.json();
      setTemplate(data);
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to load template',
        variant: 'destructive'
      });
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete() {
    if (!confirm('Are you sure you want to delete this template?')) {
      return;
    }

    try {
      const response = await fetch(`/api/projects/templates/${templateId}`, {
        method: 'DELETE'
      });

      if (!response.ok) {
        throw new Error('Failed to delete template');
      }

      toast({
        title: 'Success',
        description: 'Template deleted successfully'
      });

      router.push('/msp/projects/templates');
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to delete template',
        variant: 'destructive'
      });
    }
  }

  async function handleDuplicate() {
    try {
      const response = await fetch(`/api/projects/templates/${templateId}/duplicate`, {
        method: 'POST'
      });

      if (!response.ok) {
        throw new Error('Failed to duplicate template');
      }

      const { template_id } = await response.json();

      toast({
        title: 'Success',
        description: 'Template duplicated successfully'
      });

      router.push(`/msp/projects/templates/${template_id}`);
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to duplicate template',
        variant: 'destructive'
      });
    }
  }

  if (loading) {
    return (
      <div className="p-6">
        <div className="animate-pulse">
          <div className="h-8 bg-gray-200 rounded w-1/4 mb-4"></div>
          <div className="h-64 bg-gray-200 rounded"></div>
        </div>
      </div>
    );
  }

  if (!template) {
    return (
      <div className="p-6">
        <div className="text-center">
          <h2 className="text-2xl font-bold mb-4">Template Not Found</h2>
          <Button onClick={() => router.push('/msp/projects/templates')}>
            Back to Templates
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex justify-between items-center mb-6">
        <div className="flex items-center gap-4">
          <Button
            id="back-to-templates"
            variant="ghost"
            onClick={() => router.push('/msp/projects/templates')}
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back
          </Button>
          <h1 className="text-2xl font-bold">{template.template_name}</h1>
        </div>
        <div className="flex gap-2">
          <Button
            id="edit-template"
            variant="outline"
            onClick={() => router.push(`/msp/projects/templates/${templateId}/edit`)}
          >
            <Edit className="h-4 w-4 mr-2" />
            Edit
          </Button>
          <Button
            id="duplicate-template"
            variant="outline"
            onClick={handleDuplicate}
          >
            <Copy className="h-4 w-4 mr-2" />
            Duplicate
          </Button>
          <Button
            id="delete-template"
            variant="outline"
            onClick={handleDelete}
          >
            <Trash className="h-4 w-4 mr-2" />
            Delete
          </Button>
        </div>
      </div>

      {/* Template Info */}
      <Card className="p-6 mb-6">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-sm font-medium text-gray-500">Description</label>
            <p className="mt-1">{template.description || '-'}</p>
          </div>
          <div>
            <label className="text-sm font-medium text-gray-500">Category</label>
            <p className="mt-1">{template.category || '-'}</p>
          </div>
          <div>
            <label className="text-sm font-medium text-gray-500">Times Used</label>
            <p className="mt-1">{template.use_count}</p>
          </div>
          <div>
            <label className="text-sm font-medium text-gray-500">Last Used</label>
            <p className="mt-1">
              {template.last_used_at
                ? new Date(template.last_used_at).toLocaleDateString()
                : 'Never'}
            </p>
          </div>
        </div>
      </Card>

      {/* Phases */}
      <Card className="p-6 mb-6">
        <h2 className="text-xl font-bold mb-4">Phases ({template.phases?.length || 0})</h2>
        {template.phases && template.phases.length > 0 ? (
          <div className="space-y-4">
            {template.phases.map((phase) => {
              const phaseTasks = template.tasks?.filter(
                (task) => task.template_phase_id === phase.template_phase_id
              ) || [];

              return (
                <div key={phase.template_phase_id} className="border rounded-lg p-4">
                  <div className="flex justify-between items-start mb-2">
                    <div>
                      <h3 className="font-semibold">{phase.phase_name}</h3>
                      {phase.description && (
                        <p className="text-sm text-gray-600 mt-1">{phase.description}</p>
                      )}
                    </div>
                    <div className="text-sm text-gray-500">
                      {phase.duration_days && `${phase.duration_days} days`}
                      {phase.start_offset_days > 0 && ` (offset: +${phase.start_offset_days} days)`}
                    </div>
                  </div>

                  {/* Tasks in this phase */}
                  {phaseTasks.length > 0 && (
                    <div className="mt-4 pl-4 border-l-2 border-gray-200">
                      <h4 className="text-sm font-medium mb-2">Tasks ({phaseTasks.length})</h4>
                      <ul className="space-y-2">
                        {phaseTasks.map((task) => (
                          <li key={task.template_task_id} className="text-sm">
                            <div className="flex justify-between">
                              <span>{task.task_name}</span>
                              <span className="text-gray-500">
                                {task.estimated_hours && `${task.estimated_hours}h`}
                              </span>
                            </div>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-gray-500">No phases defined</p>
        )}
      </Card>

      {/* Dependencies */}
      {template.dependencies && template.dependencies.length > 0 && (
        <Card className="p-6 mb-6">
          <h2 className="text-xl font-bold mb-4">
            Dependencies ({template.dependencies.length})
          </h2>
          <div className="space-y-2">
            {template.dependencies.map((dep) => {
              const predecessorTask = template.tasks?.find(
                (t) => t.template_task_id === dep.predecessor_task_id
              );
              const successorTask = template.tasks?.find(
                (t) => t.template_task_id === dep.successor_task_id
              );

              return (
                <div key={dep.template_dependency_id} className="text-sm border-b pb-2">
                  <span className="font-medium">{predecessorTask?.task_name || 'Unknown'}</span>
                  <span className="mx-2 text-gray-500">→</span>
                  <span className="font-medium">{successorTask?.task_name || 'Unknown'}</span>
                  <span className="ml-2 text-gray-500">
                    ({dep.dependency_type})
                  </span>
                  {dep.lead_lag_days !== 0 && (
                    <span className="ml-2 text-gray-500">
                      {dep.lead_lag_days > 0 ? `+${dep.lead_lag_days}` : dep.lead_lag_days} days
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {/* Checklist Items */}
      {template.checklist_items && template.checklist_items.length > 0 && (
        <Card className="p-6">
          <h2 className="text-xl font-bold mb-4">
            Checklist Items ({template.checklist_items.length})
          </h2>
          <div className="space-y-2">
            {template.checklist_items.map((item) => {
              const task = template.tasks?.find(
                (t) => t.template_task_id === item.template_task_id
              );

              return (
                <div key={item.template_checklist_id} className="text-sm">
                  <span className="font-medium">{task?.task_name || 'Unknown Task'}:</span>
                  <span className="ml-2">{item.item_name}</span>
                  {item.description && (
                    <p className="text-gray-600 ml-4 mt-1">{item.description}</p>
                  )}
                </div>
              );
            })}
          </div>
        </Card>
      )}
    </div>
  );
}
