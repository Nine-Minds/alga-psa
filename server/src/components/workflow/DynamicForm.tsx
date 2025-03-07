import { useState, FormEvent, useEffect } from 'react';
import { withTheme } from '@rjsf/core';
import validator from '@rjsf/validator-ajv8';
import { RJSFSchema, UiSchema } from '@rjsf/utils';
import { customWidgets } from '../../lib/workflow/forms/customWidgets';
import { CustomFieldTemplate } from '../../lib/workflow/forms/customFieldTemplate';
import { Action, actionHandlerRegistry, ActionHandlerContext } from '../../lib/workflow/forms/actionHandlerRegistry';
import { ActionButtonGroup } from './ActionButtonGroup';
import { applyConditionalLogic } from '../../lib/workflow/forms/conditionalLogic';

// Create a themed form with default theme
const ThemedForm = withTheme({});

interface DynamicFormProps {
  schema: RJSFSchema;
  uiSchema?: UiSchema;
  formData?: any;
  onSubmit?: (formData: any) => Promise<void>;
  onAction?: (actionId: string, formData: any) => Promise<void>;
  actions?: Action[];
  taskId?: string;
  executionId?: string;
  contextData?: Record<string, any>;
  isSubmitting?: boolean;
}

export function DynamicForm({
  schema,
  uiSchema = {},
  formData = {},
  onSubmit,
  onAction,
  actions = [],
  taskId,
  executionId,
  contextData,
  isSubmitting = false
}: DynamicFormProps) {
  const [internalFormData, setInternalFormData] = useState(formData);
  const [error, setError] = useState<string | null>(null);
  const [processedSchema, setProcessedSchema] = useState(schema);
  const [processedUiSchema, setProcessedUiSchema] = useState(uiSchema);
  
  // Create default actions if none provided
  const formActions = actions.length > 0 ? actions : [
    {
      id: 'submit',
      label: 'Submit',
      primary: true,
      variant: 'default' as const,
      disabled: false,
      hidden: false,
      order: 0
    },
    ...(onAction ? [{
      id: 'cancel',
      label: 'Cancel',
      primary: false,
      variant: 'secondary' as const,
      disabled: false,
      hidden: false,
      order: 1
    }] : [])
  ];
  
  // Create a form context to allow widgets to update other fields
  const formContext = {
    updateFormData: (updates: Record<string, any>) => {
      setInternalFormData((current: any) => ({
        ...current,
        ...updates
      }));
    }
  };
  
  // Apply conditional display logic when form data changes
  useEffect(() => {
    const { schema: newSchema, uiSchema: newUiSchema } = applyConditionalLogic(
      schema,
      uiSchema,
      internalFormData
    );
    
    setProcessedSchema(newSchema);
    setProcessedUiSchema(newUiSchema);
  }, [schema, uiSchema, internalFormData]);
  
  // Handle form submission
  const handleSubmit = async (data: any, event: FormEvent<any>) => {
    if (!data.formData) return;
    
    // If onSubmit is provided, use it
    if (onSubmit) {
      await onSubmit(data.formData);
      return;
    }
    
    // Otherwise, use the action handler for 'submit'
    if (onAction) {
      await onAction('submit', data.formData);
    }
  };
  
  // Handle action button click
  const handleAction = async (actionId: string) => {
    setError(null);
    
    try {
      // If onAction is provided, use it
      if (onAction) {
        await onAction(actionId, internalFormData);
        return;
      }
      
      // Otherwise, use the action handler registry
      if (actionHandlerRegistry.hasHandler(actionId)) {
        const context: ActionHandlerContext = {
          formData: internalFormData,
          taskId,
          executionId,
          contextData
        };
        
        // Find the action or create a default one with all required properties
        const action = formActions.find(a => a.id === actionId) || {
          id: actionId,
          label: actionId,
          primary: false,
          variant: 'default' as const,
          disabled: false,
          hidden: false,
          order: 0
        };
        
        const result = await actionHandlerRegistry.executeAction(action, context);
        
        if (!result.success && result.message) {
          setError(result.message);
        }
      } else {
        console.warn(`No handler found for action: ${actionId}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
      console.error('Error handling action:', err);
    }
  };
  
  return (
    <div>
      {error && (
        <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4">
          {error}
        </div>
      )}
      
      <ThemedForm
        schema={processedSchema}
        uiSchema={{
          ...processedUiSchema,
          'ui:submitButtonOptions': {
            norender: true, // Disable default submit button
          },
        }}
        formData={internalFormData}
        formContext={formContext}
        onChange={(data: any) => {
          if (data.formData) {
            setInternalFormData(data.formData);
          }
        }}
        onSubmit={handleSubmit}
        validator={validator}
        widgets={customWidgets}
        templates={{ FieldTemplate: CustomFieldTemplate }}
      >
        <ActionButtonGroup
          actions={formActions}
          onAction={handleAction}
          isSubmitting={isSubmitting}
        />
      </ThemedForm>
    </div>
  );
}