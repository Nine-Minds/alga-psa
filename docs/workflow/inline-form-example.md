# Inline Forms in Workflows

This guide demonstrates how to use inline forms in your workflows. Inline forms allow you to define form schemas directly within your workflow code, without needing to pre-register them separately.

## Use Cases

Inline forms are ideal for:

- Ad-hoc forms that are only used in one workflow
- Dynamic forms with schema determined at runtime
- Prototyping and development where you want to iterate quickly
- Forms with a short lifecycle or single-use forms

## Implementation Overview

The system supports inline forms with the following components:

1. A database schema with an `is_temporary` flag on form definitions
2. A `createTaskWithInlineForm` method that creates temporary form definitions on-the-fly
3. A `createInlineTaskAndWaitForResult` composite action that creates a task and waits for its completion
4. A cleanup job that removes temporary forms periodically

When a task is created using an inline form, the system dynamically generates temporary, tenant-specific entries in the `workflow_form_definitions`, `workflow_form_schemas`, and `workflow_task_definitions` tables. The task instance in `workflow_tasks` then links to these temporary definitions. This allows the Task Inbox to discover and render the form using its standard mechanisms, as if it were a pre-registered form, while still allowing for ad-hoc form creation within workflows.

## Example Usage

### Basic Example: Creating a Task with Inline Form

```typescript
// In your workflow definition
async function myWorkflow(context) {
  // Create a task with an inline form definition
  const createTaskResult = await context.actions.create_task_with_inline_form({
    title: "Approve Service Request",
    description: "Please review and approve this service request",
    priority: "high",
    dueDate: new Date(Date.now() + 86400000).toISOString(), // 1 day from now
    assignTo: {
      roles: ["approver"],
    },
    contextData: {
      requestId: "REQ-12345",
      serviceName: "Server Provisioning",
      requestedBy: "john.doe@example.com"
    },
    form: {
      jsonSchema: {
        type: "object",
        required: ["approved", "comments"],
        properties: {
          requestInfo: {
            type: "string",
            title: "Request Information",
            default: "Service: ${contextData.serviceName}\nRequested by: ${contextData.requestedBy}",
            readOnly: true
          },
          approved: {
            type: "boolean",
            title: "Approve Request",
            default: false
          },
          comments: {
            type: "string",
            title: "Comments"
          }
        }
      },
      uiSchema: {
        requestInfo: {
          "ui:widget": "textarea",
          "ui:options": {
            rows: 3
          }
        },
        comments: {
          "ui:widget": "textarea",
          "ui:options": {
            rows: 5
          }
        }
      }
    },
    formCategory: "approvals"
  });

  if (createTaskResult.success) {
    console.log(`Task created with ID: ${createTaskResult.taskId}`);
    
    // Continue with workflow logic...
    // Note that the task is asynchronous - the workflow continues while the task is pending
  }
}
```

### Advanced Example: Creating a Task and Waiting for Result

```typescript
// In your workflow definition
async function customerServiceWorkflow(context) {
  try {
    // Create a task with inline form and wait for its completion
    const taskResult = await context.actions.createInlineTaskAndWaitForResult({
      title: `Mapping Error for Product: ${context.state.productName}`,
      description: 'Please resolve this mapping issue',
      priority: 'high',
      contextData: {
        serviceId: context.state.serviceId,
        errorDetails: context.state.errorMessage
      },
      form: {
        jsonSchema: {
          type: 'object',
          properties: {
            errorDetails: {
              type: 'string',
              title: 'Error Details',
              readOnly: true,
              default: '${contextData.errorMessage}'
            },
            resolution: {
              type: 'string',
              title: 'Resolution Notes'
            },
            resolved: {
              type: 'boolean',
              title: 'Mark as Resolved',
              default: false
            }
          },
          required: ['resolution', 'resolved']
        },
        uiSchema: {
          errorDetails: {
            'ui:widget': 'textarea',
            'ui:readonly': true
          },
          resolution: {
            'ui:widget': 'textarea'
          }
        }
      },
      waitForEventTimeoutMilliseconds: 3600000 // Optional: 1 hour timeout
    });

    if (taskResult.success) {
      // Process the result data
      const resolutionData = taskResult.resolutionData;
      
      if (resolutionData.resolved) {
        console.log(`Issue resolved: ${resolutionData.resolution}`);
        await context.actions.update_ticket_status({
          ticketId: context.state.ticketId,
          status: 'resolved',
          resolution: resolutionData.resolution
        });
      } else {
        console.log('Issue marked as unresolved');
        await context.actions.escalate_ticket({
          ticketId: context.state.ticketId,
          notes: resolutionData.resolution
        });
      }
    } else {
      // Handle error or timeout
      console.error(`Task failed: ${taskResult.error}`);
      await context.actions.log_error({
        message: `Task failed: ${taskResult.error}`,
        details: taskResult.details
      });
    }
  } catch (error) {
    console.error('Error in workflow execution:', error);
  }
}
```

## Dynamic Form Generation

One of the key benefits of inline forms is the ability to generate form schemas dynamically based on runtime data:

```typescript
async function dynamicFormWorkflow(context) {
  // Get data that will influence the form
  const serviceData = await context.actions.get_service_data({
    serviceId: context.state.serviceId
  });
  
  // Dynamically build form schema based on service fields
  const formProperties = {
    serviceId: {
      type: 'string',
      title: 'Service ID',
      default: serviceData.id,
      readOnly: true
    },
    serviceName: {
      type: 'string',
      title: 'Service Name',
      default: serviceData.name,
      readOnly: true
    }
  };
  
  // Add fields based on service configuration
  if (serviceData.hasScheduling) {
    formProperties.scheduleDate = {
      type: 'string',
      format: 'date',
      title: 'Schedule Date'
    };
    
    formProperties.scheduleTimeSlot = {
      type: 'string',
      title: 'Time Slot',
      enum: serviceData.availableTimeSlots
    };
  }
  
  if (serviceData.requiresApproval) {
    formProperties.approvalNote = {
      type: 'string',
      title: 'Approval Notes'
    };
  }
  
  // Create form with dynamically generated schema
  const taskResult = await context.actions.createInlineTaskAndWaitForResult({
    title: `Configure Service: ${serviceData.name}`,
    assignTo: {
      roles: ['service_manager']
    },
    form: {
      jsonSchema: {
        type: 'object',
        required: serviceData.hasScheduling ? ['scheduleDate', 'scheduleTimeSlot'] : [],
        properties: formProperties
      }
    }
  });
  
  // Process the result...
}
```

## Form Cleanup

The system automatically cleans up temporary forms using a scheduled job that runs daily. You can also manually trigger cleanup if needed:

```typescript
// Manually trigger cleanup in a workflow if needed
await context.actions.cleanup_temporary_forms({
  tenant: context.tenant
});
```

## Best Practices

1. **Use inline forms for single-use cases**: If a form will be reused across multiple workflows, consider registering it normally instead.

2. **Keep form schemas modular**: Focus on what the current task needs rather than creating large, complex forms.

3. **Provide rich context data**: Include all relevant information in the `contextData` property to make forms more useful.

4. **Set realistic timeouts**: When using `createInlineTaskAndWaitForResult`, set timeouts appropriate to your business process.

5. **Handle timeouts gracefully**: Always check the `success` flag and handle errors appropriately.

6. **Use proper form categories**: Setting a meaningful `formCategory` helps with organization and filtering in the UI.

## Limitations

1. Inline forms are marked as temporary and will be cleaned up periodically.

2. They are only accessible within the workflow execution context and associated tasks.

3. They don't appear in the form registry for general use outside their specific tasks.

4. Changes to inline forms require workflow code updates; they can't be edited separately.
