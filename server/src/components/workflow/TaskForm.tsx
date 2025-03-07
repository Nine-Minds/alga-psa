import { useState } from 'react';
import { DynamicForm } from './DynamicForm';
import { submitTaskForm } from '../../lib/actions/workflow-actions/taskInboxActions';
import { Action } from '../../lib/workflow/forms/actionHandlerRegistry';

interface TaskFormProps {
  taskId: string;
  schema: any;
  uiSchema: any;
  initialFormData: any;
  onComplete?: () => void;
  actions?: Action[];
  contextData?: Record<string, any>;
  executionId?: string;
}

export function TaskForm({
  taskId,
  schema,
  uiSchema,
  initialFormData,
  onComplete,
  actions,
  contextData,
  executionId
}: TaskFormProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  // Default task actions if none provided
  const taskActions: Action[] = actions || [
    {
      id: 'submit',
      label: 'Complete Task',
      primary: true,
      variant: 'default' as const,
      disabled: false,
      hidden: false,
      order: 0
    },
    {
      id: 'save_draft',
      label: 'Save Draft',
      primary: false,
      variant: 'secondary' as const,
      disabled: false,
      hidden: false,
      order: 1
    }
  ];
  
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
    />
  );
}