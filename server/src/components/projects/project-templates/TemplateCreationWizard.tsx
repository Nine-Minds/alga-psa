'use client';

import React, { useEffect, useState } from 'react';
import { Dialog } from 'server/src/components/ui/Dialog';
import { WizardProgress } from 'server/src/components/onboarding/WizardProgress';
import { WizardNavigation } from 'server/src/components/onboarding/WizardNavigation';
import { TemplateBasicsStep } from './wizard-steps/TemplateBasicsStep';
import { TemplateStatusColumnsStep } from './wizard-steps/TemplateStatusColumnsStep';
import { TemplatePhasesStep } from './wizard-steps/TemplatePhasesStep';
import { TemplateTasksStep } from './wizard-steps/TemplateTasksStep';
import { TemplateReviewStep } from './wizard-steps/TemplateReviewStep';
import { createTemplateFromWizard } from 'server/src/lib/actions/project-actions/projectTemplateWizardActions';
import { getTenantProjectStatuses } from 'server/src/lib/actions/project-actions/projectTaskStatusActions';
import { getTaskTypes } from 'server/src/lib/actions/project-actions/projectTaskActions';
import { getAllPriorities } from 'server/src/lib/actions/priorityActions';
import { getAllUsers } from 'server/src/lib/actions/user-actions/userActions';
import { getServices } from 'server/src/lib/actions/serviceActions';
import { IUserWithRoles } from 'server/src/interfaces/auth.interfaces';
import { IStatus } from 'server/src/interfaces/status.interface';
import { IService } from 'server/src/interfaces/billing.interfaces';

const STEPS = [
  'Template Basics',
  'Task Status Columns',
  'Phases',
  'Tasks',
  'Review & Create',
] as const;

const REQUIRED_STEPS = [0, 4]; // Basics and Review are required

export interface TemplateStatusMapping {
  temp_id: string;
  status_id?: string;
  custom_status_name?: string;
  custom_status_color?: string;
  display_order: number;
}

export interface TemplatePhase {
  temp_id: string;
  phase_name: string;
  description?: string;
  duration_days?: number;
  start_offset_days: number;
  order_number: number;
}

export interface TemplateTask {
  temp_id: string;
  phase_temp_id: string;
  task_name: string;
  description?: string;
  estimated_hours?: number;
  duration_days?: number;
  task_type_key?: string;
  priority_id?: string;
  assigned_to?: string; // Primary user ID to assign task to
  additional_agents?: string[]; // Additional user IDs
  template_status_mapping_id?: string; // Which status column this task should start in
  service_id?: string; // Service for time entry prefill
  order_number: number;
}

export interface TemplateChecklistItem {
  temp_id: string;
  task_temp_id: string;
  item_name: string;
  description?: string;
  order_number: number;
}

export interface TemplateWizardData {
  template_name: string;
  description?: string;
  category?: string;
  status_mappings: TemplateStatusMapping[];
  phases: TemplatePhase[];
  tasks: TemplateTask[];
  checklist_items: TemplateChecklistItem[];
}

interface TemplateCreationWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onComplete?: (templateId: string) => void;
}

export function TemplateCreationWizard({
  open,
  onOpenChange,
  onComplete,
}: TemplateCreationWizardProps) {
  const [currentStep, setCurrentStep] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [errors, setErrors] = useState<Record<number, string>>({});
  const [completedSteps, setCompletedSteps] = useState<Set<number>>(new Set());

  const [availableStatuses, setAvailableStatuses] = useState<
    Array<{ status_id: string; name: string; color?: string; is_closed?: boolean }>
  >([]);
  const [isLoadingStatuses, setIsLoadingStatuses] = useState(true);

  const [taskTypes, setTaskTypes] = useState<
    Array<{ type_key: string; type_name: string; color?: string }>
  >([]);
  const [priorities, setPriorities] = useState<
    Array<{ priority_id: string; priority_name: string }>
  >([]);
  const [users, setUsers] = useState<IUserWithRoles[]>([]);
  const [services, setServices] = useState<IService[]>([]);

  const [wizardData, setWizardData] = useState<TemplateWizardData>({
    template_name: '',
    description: '',
    category: '',
    status_mappings: [],
    phases: [],
    tasks: [],
    checklist_items: [],
  });

  useEffect(() => {
    if (!open) {
      resetWizard();
      return;
    }

    // Load task statuses (for Kanban board), task types, priorities, users, and services
    const loadData = async () => {
      try {
        setIsLoadingStatuses(true);
        const [statuses, types, priorities, allUsers, servicesResponse] = await Promise.all([
          getTenantProjectStatuses(), // Project task statuses for Kanban board
          getTaskTypes(),
          getAllPriorities('project_task'),
          getAllUsers(true, 'internal'), // Load internal users only
          getServices(1, 999), // Load all services
        ]);
        console.log('[TemplateCreationWizard] Loaded statuses:', statuses);
        setAvailableStatuses(
          statuses.map((s) => ({
            status_id: s.status_id,
            name: s.name,
            color: s.color || undefined,
            is_closed: s.is_closed,
          }))
        );
        setTaskTypes(
          types.map((t) => ({
            type_key: t.type_key,
            type_name: t.type_name,
            color: t.color,
          }))
        );
        const mappedPriorities = priorities.map((p) => ({
          priority_id: p.priority_id,
          priority_name: p.priority_name,
        }));
        console.log('Loaded priorities for project_task:', mappedPriorities);
        setPriorities(mappedPriorities);
        setUsers(allUsers);
        setServices(servicesResponse.services);
      } catch (error) {
        console.error('Failed to load wizard data', error);
        setErrors({ [currentStep]: 'Failed to load required data' });
      } finally {
        setIsLoadingStatuses(false);
      }
    };

    loadData();
  }, [open]);

  const resetWizard = () => {
    setWizardData({
      template_name: '',
      description: '',
      category: '',
      status_mappings: [],
      phases: [],
      tasks: [],
      checklist_items: [],
    });
    setErrors({});
    setCompletedSteps(new Set());
    setCurrentStep(0);
  };

  const updateData = (data: Partial<TemplateWizardData>) => {
    setWizardData((prev) => ({ ...prev, ...data }));
    // Clear error for current step when data changes
    setErrors((prev) => ({ ...prev, [currentStep]: '' }));
  };

  // Handle when a new status is created in the Status Columns step
  const handleStatusCreated = (newStatus: IStatus) => {
    setAvailableStatuses((prev) => [
      ...prev,
      {
        status_id: newStatus.status_id,
        name: newStatus.name,
        color: newStatus.color || undefined,
        is_closed: newStatus.is_closed,
      },
    ]);
  };

  const validateStep = (stepIndex: number): boolean => {
    setErrors((prev) => ({ ...prev, [stepIndex]: '' }));

    switch (stepIndex) {
      case 0: // Basics
        if (!wizardData.template_name?.trim()) {
          setErrors((prev) => ({ ...prev, [stepIndex]: 'Template name is required' }));
          return false;
        }
        return true;

      case 1: // Status Columns
        // Optional step, always valid
        return true;

      case 2: // Phases
        // Optional step - validation happens at save time (Done button)
        return true;

      case 3: // Tasks
        // Optional step - validation happens at save time (Done button)
        return true;

      case 4: // Review
        // Final validation
        if (!wizardData.template_name?.trim()) {
          setErrors((prev) => ({ ...prev, [stepIndex]: 'Template name is required' }));
          return false;
        }
        return true;

      default:
        return true;
    }
  };

  const handleNext = () => {
    if (!validateStep(currentStep)) {
      return;
    }
    if (currentStep < STEPS.length - 1) {
      setCompletedSteps((prev) => new Set([...prev, currentStep]));
      setCurrentStep((prev) => prev + 1);
    }
  };

  const handleBack = () => {
    if (currentStep > 0) {
      setCurrentStep((prev) => prev - 1);
    }
  };

  const handleSkip = () => {
    if (currentStep < STEPS.length - 1 && !REQUIRED_STEPS.includes(currentStep)) {
      setCurrentStep((prev) => prev + 1);
    }
  };

  const handleStepClick = (stepIndex: number) => {
    if (
      stepIndex === 0 ||
      stepIndex === currentStep ||
      completedSteps.has(stepIndex) ||
      (stepIndex > 0 && completedSteps.has(stepIndex - 1))
    ) {
      setCurrentStep(stepIndex);
    }
  };

  const handleFinish = async () => {
    if (!validateStep(currentStep)) {
      return;
    }

    setIsLoading(true);
    try {
      const templateId = await createTemplateFromWizard(wizardData);
      onComplete?.(templateId);
      onOpenChange(false);
    } catch (error) {
      console.error('Error creating template', error);
      setErrors((prev) => ({
        ...prev,
        [currentStep]: error instanceof Error ? error.message : 'Failed to create template',
      }));
    } finally {
      setIsLoading(false);
    }
  };

  const renderStep = () => {
    switch (currentStep) {
      case 0:
        return <TemplateBasicsStep data={wizardData} updateData={updateData} />;
      case 1:
        return (
          <TemplateStatusColumnsStep
            data={wizardData}
            updateData={updateData}
            availableStatuses={availableStatuses}
            isLoadingStatuses={isLoadingStatuses}
            onStatusCreated={handleStatusCreated}
          />
        );
      case 2:
        return <TemplatePhasesStep data={wizardData} updateData={updateData} />;
      case 3:
        return (
          <TemplateTasksStep
            data={wizardData}
            updateData={updateData}
            taskTypes={taskTypes}
            priorities={priorities}
            availableStatuses={availableStatuses}
            users={users}
            services={services}
          />
        );
      case 4:
        return <TemplateReviewStep data={wizardData} availableStatuses={availableStatuses} />;
      default:
        return null;
    }
  };

  return (
    <Dialog
      isOpen={open}
      onClose={() => onOpenChange(false)}
      title="Create New Project Template"
      className="max-w-4xl max-h-[90vh]"
    >
      <div className="flex flex-col h-full">
        <div className="flex-shrink-0 px-6 pt-6">
          <WizardProgress
            steps={STEPS as unknown as string[]}
            currentStep={currentStep}
            completedSteps={completedSteps}
            onStepClick={handleStepClick}
            canNavigateToStep={(stepIndex) =>
              stepIndex === 0 ||
              stepIndex === currentStep ||
              completedSteps.has(stepIndex) ||
              (stepIndex > 0 && completedSteps.has(stepIndex - 1))
            }
          />
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-6">
          <div className="mb-4">{renderStep()}</div>

          {errors[currentStep] && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md">
              <p className="text-red-700 text-sm">{errors[currentStep]}</p>
            </div>
          )}
        </div>

        <div className="flex-shrink-0 px-6 pb-6 bg-white">
          <WizardNavigation
            currentStep={currentStep}
            totalSteps={STEPS.length}
            onBack={handleBack}
            onNext={handleNext}
            onSkip={handleSkip}
            onFinish={handleFinish}
            isNextDisabled={isLoading}
            isSkipDisabled={REQUIRED_STEPS.includes(currentStep)}
            isLoading={isLoading}
            finishLabel="Create Template"
          />
        </div>
      </div>
    </Dialog>
  );
}
