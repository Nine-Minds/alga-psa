'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from 'server/src/components/ui/Button';
import { Card } from 'server/src/components/ui/Card';
import { ArrowLeft, Circle, Trash, FileText, MoreVertical, Rocket } from 'lucide-react';
import { IProjectTemplateWithDetails, IProjectTemplateTask, IProjectTemplatePhase } from 'server/src/interfaces/projectTemplate.interfaces';
import { deleteTemplate } from 'server/src/lib/actions/project-actions/projectTemplateActions';
import { toast } from 'react-hot-toast';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "server/src/components/ui/DropdownMenu";
import { ApplyTemplateDialog } from './ApplyTemplateDialog';
import styles from '../ProjectDetail.module.css';

interface TemplateDetailProps {
  template: IProjectTemplateWithDetails;
  onTemplateUpdated: () => void;
}

export default function TemplateDetail({ template, onTemplateUpdated }: TemplateDetailProps) {
  const router = useRouter();
  const [isDeleting, setIsDeleting] = useState(false);
  const [showApplyDialog, setShowApplyDialog] = useState(false);
  const [selectedPhase, setSelectedPhase] = useState<IProjectTemplatePhase | null>(
    template.phases?.[0] || null
  );

  async function handleDelete() {
    if (!confirm('Are you sure you want to delete this template?')) {
      return;
    }

    try {
      setIsDeleting(true);
      await deleteTemplate(template.template_id);
      toast.success('Template deleted successfully');
      router.push('/msp/projects/templates');
    } catch (error) {
      toast.error('Failed to delete template');
      console.error('Error deleting template:', error);
    } finally {
      setIsDeleting(false);
    }
  }

  const phases = template.phases || [];
  const tasks = template.tasks || [];
  const statusMappings = template.status_mappings || [];

  // Helper to lighten hex color (for background)
  const lightenColor = (hex: string, percent: number) => {
    const num = parseInt(hex.replace('#', ''), 16);
    const r = Math.min(255, Math.floor((num >> 16) + (255 - (num >> 16)) * percent));
    const g = Math.min(255, Math.floor(((num >> 8) & 0x00FF) + (255 - ((num >> 8) & 0x00FF)) * percent));
    const b = Math.min(255, Math.floor((num & 0x0000FF) + (255 - (num & 0x0000FF)) * percent));
    return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
  };

  const renderPhaseContent = () => {
    if (!selectedPhase) {
      return (
        <div className="flex items-center justify-center h-64 bg-gray-100 rounded-lg">
          <div className="text-center">
            <p className="text-xl text-gray-600">
              Please select a phase to view the template details.
            </p>
          </div>
        </div>
      );
    }

    // Get tasks for selected phase
    const phaseTasks = tasks.filter(
      (task) => task.template_phase_id === selectedPhase.template_phase_id
    );

    return (
      <div className="flex flex-col h-full">
        <div className="mb-4">
          <div className="flex justify-between items-center gap-4">
            {/* Phase Title */}
            <div>
              <h2 className="text-xl font-bold mb-1">Phase: {selectedPhase.phase_name}</h2>
              {selectedPhase.description && (
                <p className="text-sm text-gray-600">{selectedPhase.description}</p>
              )}
              <div className="text-sm text-gray-500 mt-1">
                {selectedPhase.duration_days && `Duration: ${selectedPhase.duration_days} days`}
                {selectedPhase.start_offset_days > 0 && ` • Start: +${selectedPhase.start_offset_days} days`}
              </div>
            </div>
          </div>
        </div>

        {/* Kanban Board */}
        <div className={styles.kanbanWrapper}>
          {statusMappings.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              No status columns defined
            </div>
          ) : (
            <div className={styles.kanbanBoard}>
              {statusMappings
                .sort((a, b) => a.display_order - b.display_order)
                .map((statusMapping, index) => {
                  // Distribute tasks across status columns
                  const tasksPerColumn = Math.ceil(phaseTasks.length / statusMappings.length);
                  const startIndex = index * tasksPerColumn;
                  const endIndex = startIndex + tasksPerColumn;
                  const statusTasks = phaseTasks.slice(startIndex, endIndex);

                  const displayName = statusMapping.status_name || statusMapping.custom_status_name || 'Status';
                  const statusColor = statusMapping.color || '#6B7280';

                  return (
                    <div
                      key={statusMapping.template_status_mapping_id}
                      className={`${styles.kanbanColumn} rounded-lg transition-all duration-200`}
                      style={{ backgroundColor: lightenColor(statusColor, 0.85) }}
                    >
                      {/* Status Column Header */}
                      <div className="font-bold text-sm p-3 rounded-t-lg flex items-center justify-between relative">
                        <div
                          className="flex rounded-[20px] border-2 shadow-sm items-center ps-3 py-3 pe-4"
                          style={{
                            backgroundColor: lightenColor(statusColor, 0.70),
                            borderColor: lightenColor(statusColor, 0.40)
                          }}
                        >
                          <Circle className="w-4 h-4 mr-2" fill={statusColor} stroke={statusColor} />
                          <span className="ml-2">{displayName}</span>
                        </div>
                        <div className={styles.taskCount}>
                          {statusTasks.length}
                        </div>
                      </div>

                      {/* Tasks in this status */}
                      <div className={styles.kanbanTasks}>
                        <div className="space-y-2">
                          {statusTasks.map((task) => (
                            <TaskCard key={task.template_task_id} task={task} />
                          ))}
                        </div>
                      </div>
                    </div>
                  );
                })}
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <>
      <ApplyTemplateDialog
        open={showApplyDialog}
        onClose={() => setShowApplyDialog(false)}
        onSuccess={(projectId) => {
          setShowApplyDialog(false);
          router.push(`/msp/projects/${projectId}`);
        }}
        initialTemplateId={template.template_id}
      />

      <div className={styles.pageContainer}>
        {/* Template Header - Top */}
        <div className="border-b px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Button
                id="back-to-templates"
                variant="ghost"
                onClick={() => router.push('/msp/projects/templates')}
              >
                <ArrowLeft className="h-4 w-4 mr-2" />
                Back
              </Button>
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-2 px-3 py-1 bg-purple-100 text-purple-700 rounded-full text-sm font-medium">
                  <FileText className="h-4 w-4" />
                  Template
                </div>
                <h1 className="text-2xl font-bold">{template.template_name}</h1>
              </div>
            </div>
            <div className="flex gap-2">
              <Button
                id="use-template"
                onClick={() => setShowApplyDialog(true)}
              >
                <Rocket className="h-4 w-4 mr-2" />
                Use Template
              </Button>
              <Button
                id="delete-template"
                variant="outline"
                onClick={handleDelete}
                disabled={isDeleting}
              >
                <Trash className="h-4 w-4 mr-2" />
                Delete
              </Button>
            </div>
          </div>

          {/* Template metadata */}
          <div className="mt-4 flex gap-6 text-sm text-gray-600">
            {template.description && (
              <div>
                <span className="font-medium">Description:</span> {template.description}
              </div>
            )}
            {template.category && (
              <div>
                <span className="font-medium">Category:</span> {template.category}
              </div>
            )}
            <div>
              <span className="font-medium">Used:</span> {template.use_count} times
            </div>
          </div>
        </div>

        <div className={styles.mainContent}>
          <div className={styles.contentWrapper}>
            {/* Phases List - Left Side */}
            <div className={styles.phasesList}>
              <Card className="p-4">
                <h3 className="text-sm font-semibold text-gray-700 mb-3">Project Phases</h3>
                <div className="space-y-1">
                  {phases.length === 0 ? (
                    <div className="text-sm text-gray-500">No phases defined</div>
                  ) : (
                    phases.map((phase) => (
                      <button
                        key={phase.template_phase_id}
                        onClick={() => setSelectedPhase(phase)}
                        className={`w-full text-left px-3 py-2 rounded-lg transition-colors ${
                          selectedPhase?.template_phase_id === phase.template_phase_id
                            ? 'bg-purple-100 text-purple-900 font-medium'
                            : 'hover:bg-gray-100 text-gray-700'
                        }`}
                      >
                        <div className="text-sm font-medium">{phase.phase_name}</div>
                        {phase.duration_days && (
                          <div className="text-xs text-gray-500 mt-1">
                            {phase.duration_days} days
                          </div>
                        )}
                      </button>
                    ))
                  )}
                </div>
              </Card>
            </div>

            {/* Kanban Board - Right Side */}
            <div className={styles.kanbanContainer}>
              {renderPhaseContent()}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

// Task Card Component
function TaskCard({ task }: { task: IProjectTemplateTask }) {
  return (
    <div className="bg-white border rounded-lg p-3 shadow-sm hover:shadow-md transition-shadow">
      <div className="font-medium text-sm mb-1">{task.task_name}</div>
      {task.description && (
        <div className="text-xs text-gray-600 mb-2">{task.description}</div>
      )}
      <div className="flex items-center justify-between text-xs text-gray-500">
        {task.estimated_hours && (
          <span className="bg-gray-100 px-2 py-1 rounded">
            {task.estimated_hours}h
          </span>
        )}
        {task.task_type_key && (
          <span className="capitalize">{task.task_type_key}</span>
        )}
      </div>
    </div>
  );
}
