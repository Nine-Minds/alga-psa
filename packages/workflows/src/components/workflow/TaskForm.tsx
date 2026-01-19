import { useState } from 'react';
import { DynamicForm } from './DynamicForm';
import { submitTaskForm } from '@alga-psa/workflows/actions/workflow-actions/taskInboxActions';
import { Action } from '@alga-psa/workflows/forms/actionHandlerRegistry';

interface TaskFormProps {
  taskId: string;
  schema: any;
  uiSchema: any;
  initialFormData: any;
  onComplete?: () => void;
  actions?: Action[];
  contextData?: Record<string, any>;
  executionId?: string;
  isInDrawer?: boolean;
}

export function TaskForm({
  taskId,
  schema,
  uiSchema,
  initialFormData,
  onComplete,
  actions,
  contextData,
  executionId,
  isInDrawer = false
}: TaskFormProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  // Default task actions if none provided
  let taskActions: Action[] = actions || [];
  
  // If no actions were provided, create default ones
  if (taskActions.length === 0) {
    // Always add the submit button
    taskActions.push({
      id: 'submit',
      label: 'Complete Task',
      primary: true,
      variant: 'default' as const,
      disabled: false,
      hidden: false,
      order: 0
    });
    
    // Only add a cancel button if not in a drawer (drawer has its own close button)
    if (!isInDrawer) {
      taskActions.push({
        id: 'cancel',
        label: 'Cancel',
        primary: false,
        variant: 'outline' as const,
        disabled: false,
        hidden: false,
        order: 1
      });
    }
  }
  
  // Handle task actions
  const handleAction = async (actionId: string, formData: any) => {
    setIsSubmitting(true);
    
    try {
      console.log(`Handling task action: ${actionId}`, { taskId, formData });
      
      if (actionId === 'submit') {
        await submitTaskForm({
          taskId,
          formData
        });
        
        if (onComplete) {
          onComplete();
        }
      } else if (actionId === 'save_draft') {
        // Implement draft saving logic
        console.log('Saving draft:', { taskId, formData });
        // For now, just simulate a delay
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    } catch (err) {
      console.error(`Error handling task action ${actionId}:`, err);
      throw err;
    } finally {
      setIsSubmitting(false);
    }
  };
  
  return (
    <DynamicForm
      schema={schema}
      uiSchema={uiSchema}
      formData={initialFormData}
      onAction={handleAction}
      actions={taskActions}
      isSubmitting={isSubmitting}
      taskId={taskId}
      executionId={executionId}
      contextData={contextData}
      isInDrawer={isInDrawer}
    />
  );
}
