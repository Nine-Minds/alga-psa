import { useState, FormEvent, useEffect, useMemo } from 'react';
import { withTheme } from '@rjsf/core';
import validator from '@rjsf/validator-ajv8';
import { RJSFSchema, UiSchema, ValidatorType } from '@rjsf/utils';
import { customWidgets } from '@server/lib/workflow/forms/customWidgets';
// import { CustomFieldTemplate } from '@server/lib/workflow/forms/customFieldTemplate'; // Removed
// import { CustomTitleField } from '@server/lib/workflow/forms/CustomTitleField'; // Removed
import { Action, actionHandlerRegistry, ActionHandlerContext } from '@server/lib/workflow/forms/actionHandlerRegistry';
// Assuming a hypothetical shadcn theme package and import. User will need to verify/install.
import { ActionButtonGroup } from './ActionButtonGroup';
import { applyConditionalLogic } from '@server/lib/workflow/forms/conditionalLogic';
import { processTemplateVariables } from '@server/utils/templateUtils';

// Create a themed form with Shadcn theme
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
  isInDrawer?: boolean;
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
  isSubmitting = false,
  isInDrawer = false
}: DynamicFormProps) {
console.log('[DynamicForm] Received contextData:', contextData);
  console.log('[DynamicForm] Received schema:', schema);
  const [internalFormData, setInternalFormData] = useState(formData);
  const [error, setError] = useState<string | null>(null);
  const [finalSchema, setFinalSchema] = useState(schema);
  const [finalUiSchema, setFinalUiSchema] = useState(uiSchema);
  
  // Create default actions if none provided
  let formActions = actions;
  
  // If no actions were provided, create default ones
  if (formActions.length === 0) {
    formActions = [
      {
        id: 'submit',
        label: 'Submit',
        primary: true,
        variant: 'default' as const,
        disabled: false,
        hidden: false,
        order: 0
      }
    ];
    
    // Only add a cancel button if not in a drawer and onAction is provided
    if (onAction && !isInDrawer) {
      formActions.push({
        id: 'cancel',
        label: 'Cancel',
        primary: false,
        variant: 'secondary' as const,
        disabled: false,
        hidden: false,
        order: 1
      });
    }
  }
  
  // Create a form context to allow widgets to update other fields
  const formContext = {
    updateFormData: (updates: Record<string, any>) => {
      setInternalFormData((current: any) => {
        const newData = {
          ...current,
          ...updates
        };
        return processTemplateVariables(newData, contextData);
      });
    },
    // Pass contextData through formContext if widgets need direct access
    // although processing at DynamicForm level should cover most cases.
    taskContextData: contextData,
    formData: internalFormData // current processed form data
  };
  
  // Apply conditional display logic when form data changes
  useEffect(() => {
    const { schema: newSchemaFromConditionalLogic, uiSchema: newUiSchemaFromConditionalLogic } = applyConditionalLogic(
      schema, // Use the original schema prop
      uiSchema, // Original uiSchema prop is still the base for conditional UI changes
      internalFormData
    );
    
    setFinalSchema(newSchemaFromConditionalLogic);
    setFinalUiSchema(newUiSchemaFromConditionalLogic);
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
        schema={finalSchema}
        uiSchema={{
          ...finalUiSchema,
          'ui:submitButtonOptions': {
            norender: true, // Disable default submit button
          },
        }}
        formData={internalFormData}
        formContext={formContext}
        onChange={(data: any) => {
          if (data.formData) {
            console.log('[DynamicForm onChange] data.formData from RJSF:', JSON.stringify(data.formData, null, 2)); // Log RJSF's data
            const processedData = processTemplateVariables(data.formData, contextData);
            console.log('[DynamicForm onChange] processedData to be set:', JSON.stringify(processedData, null, 2)); // Log data after our processing
            setInternalFormData(processedData);
          }
        }}
        onSubmit={handleSubmit}
        validator={validator as ValidatorType<any, RJSFSchema, any>}
        widgets={customWidgets}
        // templates and fields props removed as they should be provided by the shadcnTheme
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