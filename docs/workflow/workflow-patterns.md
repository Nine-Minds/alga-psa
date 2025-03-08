# Common Workflow Patterns: Dynamic Workflow UI System

## Overview

This document provides examples of common workflow patterns that can be implemented using the Dynamic Workflow UI System. These patterns serve as templates and best practices for building workflows that leverage the system's capabilities.

> **Important Note on Workflow Execution**: Workflows are executed in response to events. When a workflow is triggered, the event that triggered it is passed as input to the workflow. The workflow does not wait for the initial event - the fact that the workflow is executing means the event has already occurred. This is reflected in the patterns below where each workflow receives its triggering event via `context.input.triggerEvent`.

## Table of Contents

1. [Approval Workflows](#approval-workflows)
   - [Simple Approval](#simple-approval)
   - [Multi-Level Approval](#multi-level-approval)
   - [Parallel Approval](#parallel-approval)
   - [Conditional Approval](#conditional-approval)

2. [Request and Fulfillment Workflows](#request-and-fulfillment-workflows)
   - [Service Request](#service-request)
   - [Credit Reimbursement](#credit-reimbursement)
   - [Resource Allocation](#resource-allocation)

3. [Review and Feedback Workflows](#review-and-feedback-workflows)
   - [Document Review](#document-review)
   - [Performance Review](#performance-review)
   - [Quality Assurance](#quality-assurance)

4. [Onboarding and Provisioning Workflows](#onboarding-and-provisioning-workflows)
   - [Customer Onboarding](#customer-onboarding)
   - [Employee Onboarding](#employee-onboarding)
   - [System Provisioning](#system-provisioning)

5. [Incident Management Workflows](#incident-management-workflows)
   - [Issue Triage](#issue-triage)
   - [Incident Response](#incident-response)
   - [Problem Management](#problem-management)

## Approval Workflows

### Simple Approval

A basic workflow where a request is submitted and approved or rejected by a single approver.

#### Workflow Definition

```typescript
import { defineWorkflow, WorkflowContext } from '../lib/workflow/core/workflowDefinition';

export const simpleApprovalWorkflow = defineWorkflow(
  'SimpleApproval',
  async (context: WorkflowContext) => {
    const { actions, events, data, logger } = context;
    
    // Initial state - Processing
    context.setState('processing');
    
    // The workflow is triggered by a Submit event, which is passed as input
    const { triggerEvent } = context.input;
    logger.info(`Processing request submitted by ${triggerEvent.user_id}`);
    
    // Store request data
    data.set('requestData', triggerEvent.payload);
    data.set('requestor', triggerEvent.user_id);
    
    // Create approval task
    const { taskId } = await actions.createHumanTask({
      taskType: 'approval',
      title: 'Approve Request',
      description: `Please review and approve the request submitted by ${submitEvent.user_id}`,
      priority: 'medium',
      dueDate: '2 days',
      assignTo: {
        roles: ['manager']
      },
      contextData: {
        requestData: submitEvent.payload,
        requestor: submitEvent.user_id
      }
    });
    
    // Update state
    context.setState('pending_approval');
    
    // Wait for task completion
    const approvalEvent = await events.waitFor(`Task:${taskId}:Complete`);
    
    // Process approval decision
    const { approved, comments } = approvalEvent.payload;
    
    if (approved) {
      // Handle approval
      await actions.sendNotification({
        recipient: data.get('requestor'),
        template: 'request_approved',
        data: {
          comments
        }
      });
      
      context.setState('approved');
    } else {
      // Handle rejection
      await actions.sendNotification({
        recipient: data.get('requestor'),
        template: 'request_rejected',
        data: {
          comments
        }
      });
      
      context.setState('rejected');
    }
    
    logger.info('Workflow completed');
  }
);
```

#### Form Definition

```typescript
// Approval form definition
const approvalForm = {
  formId: 'simple-approval-form',
  name: 'Simple Approval Form',
  description: 'Form for approving or rejecting a request',
  version: '1.0.0',
  category: 'approval',
  status: FormStatus.ACTIVE,
  jsonSchema: {
    type: 'object',
    required: ['approved'],
    properties: {
      approved: {
        type: 'boolean',
        title: 'Approve this request?',
        default: false
      },
      comments: {
        type: 'string',
        title: 'Comments',
        description: 'Provide any comments or feedback'
      }
    }
  },
  uiSchema: {
    approved: {
      'ui:widget': 'checkbox'
    },
    comments: {
      'ui:widget': 'textarea',
      'ui:options': {
        rows: 5
      }
    }
  }
};
```

### Multi-Level Approval

A workflow where a request requires approval from multiple levels of management in sequence.

#### Workflow Definition

```typescript
import { defineWorkflow, WorkflowContext } from '../lib/workflow/core/workflowDefinition';

export const multiLevelApprovalWorkflow = defineWorkflow(
  'MultiLevelApproval',
  async (context: WorkflowContext) => {
    const { actions, events, data, logger } = context;
    
    // Initial state - Processing
    context.setState('processing');
    
    // The workflow is triggered by a Submit event, which is passed as input
    const { triggerEvent } = context.input;
    
    // Store request data
    data.set('requestData', triggerEvent.payload);
    data.set('requestor', triggerEvent.user_id);
    
    // First level approval (Team Lead)
    context.setState('pending_team_lead_approval');
    
    const { taskId: teamLeadTaskId } = await actions.createHumanTask({
      taskType: 'approval',
      title: 'Team Lead Approval',
      description: 'First level approval by Team Lead',
      priority: 'medium',
      assignTo: {
        roles: ['team_lead']
      },
      contextData: {
        requestData: submitEvent.payload,
        requestor: submitEvent.user_id
      }
    });
    
    // Wait for team lead decision
    const teamLeadEvent = await events.waitFor(`Task:${teamLeadTaskId}:Complete`);
    
    // If rejected by team lead, end workflow
    if (!teamLeadEvent.payload.approved) {
      await actions.sendNotification({
        recipient: data.get('requestor'),
        template: 'request_rejected',
        data: {
          level: 'Team Lead',
          comments: teamLeadEvent.payload.comments
        }
      });
      
      context.setState('rejected_by_team_lead');
      return;
    }
    
    // Store team lead approval
    data.set('teamLeadApproval', {
      approver: teamLeadEvent.user_id,
      timestamp: teamLeadEvent.timestamp,
      comments: teamLeadEvent.payload.comments
    });
    
    // Second level approval (Manager)
    context.setState('pending_manager_approval');
    
    const { taskId: managerTaskId } = await actions.createHumanTask({
      taskType: 'approval',
      title: 'Manager Approval',
      description: 'Second level approval by Manager',
      priority: 'medium',
      assignTo: {
        roles: ['manager']
      },
      contextData: {
        requestData: submitEvent.payload,
        requestor: submitEvent.user_id,
        teamLeadApproval: data.get('teamLeadApproval')
      }
    });
    
    // Wait for manager decision
    const managerEvent = await events.waitFor(`Task:${managerTaskId}:Complete`);
    
    // If rejected by manager, end workflow
    if (!managerEvent.payload.approved) {
      await actions.sendNotification({
        recipient: data.get('requestor'),
        template: 'request_rejected',
        data: {
          level: 'Manager',
          comments: managerEvent.payload.comments
        }
      });
      
      context.setState('rejected_by_manager');
      return;
    }
    
    // Store manager approval
    data.set('managerApproval', {
      approver: managerEvent.user_id,
      timestamp: managerEvent.timestamp,
      comments: managerEvent.payload.comments
    });
    
    // For high-value requests, require director approval
    if (submitEvent.payload.amount > 10000) {
      // Third level approval (Director)
      context.setState('pending_director_approval');
      
      const { taskId: directorTaskId } = await actions.createHumanTask({
        taskType: 'approval',
        title: 'Director Approval',
        description: 'Third level approval by Director (required for high-value requests)',
        priority: 'high',
        assignTo: {
          roles: ['director']
        },
        contextData: {
          requestData: submitEvent.payload,
          requestor: submitEvent.user_id,
          teamLeadApproval: data.get('teamLeadApproval'),
          managerApproval: data.get('managerApproval')
        }
      });
      
      // Wait for director decision
      const directorEvent = await events.waitFor(`Task:${directorTaskId}:Complete`);
      
      // If rejected by director, end workflow
      if (!directorEvent.payload.approved) {
        await actions.sendNotification({
          recipient: data.get('requestor'),
          template: 'request_rejected',
          data: {
            level: 'Director',
            comments: directorEvent.payload.comments
          }
        });
        
        context.setState('rejected_by_director');
        return;
      }
      
      // Store director approval
      data.set('directorApproval', {
        approver: directorEvent.user_id,
        timestamp: directorEvent.timestamp,
        comments: directorEvent.payload.comments
      });
    }
    
    // All required approvals received
    await actions.sendNotification({
      recipient: data.get('requestor'),
      template: 'request_approved',
      data: {
        approvals: [
          data.get('teamLeadApproval'),
          data.get('managerApproval'),
          data.get('directorApproval')
        ].filter(Boolean)
      }
    });
    
    // Execute the approved request
    await actions.executeApprovedRequest({
      requestData: data.get('requestData'),
      approvals: [
        data.get('teamLeadApproval'),
        data.get('managerApproval'),
        data.get('directorApproval')
      ].filter(Boolean)
    });
    
    context.setState('approved');
    logger.info('Multi-level approval workflow completed');
  }
);
```

### Parallel Approval

A workflow where multiple approvers must review a request simultaneously, and all must approve for the request to proceed.

#### Workflow Definition

```typescript
import { defineWorkflow, WorkflowContext } from '../lib/workflow/core/workflowDefinition';

export const parallelApprovalWorkflow = defineWorkflow(
  'ParallelApproval',
  async (context: WorkflowContext) => {
    const { actions, events, data, logger } = context;
    
    // Initial state - Processing
    context.setState('processing');
    
    // The workflow is triggered by a Submit event, which is passed as input
    const { triggerEvent } = context.input;
    
    // Store request data
    data.set('requestData', triggerEvent.payload);
    data.set('requestor', triggerEvent.user_id);
    
    // Create approval tasks for all required approvers
    context.setState('pending_approval');
    
    // Create financial approval task
    const { taskId: financialTaskId } = await actions.createHumanTask({
      taskType: 'approval',
      title: 'Financial Approval',
      description: 'Financial review and approval',
      priority: 'medium',
      assignTo: {
        roles: ['financial_approver']
      },
      contextData: {
        requestData: submitEvent.payload,
        requestor: submitEvent.user_id,
        approvalType: 'financial'
      }
    });
    
    // Create technical approval task
    const { taskId: technicalTaskId } = await actions.createHumanTask({
      taskType: 'approval',
      title: 'Technical Approval',
      description: 'Technical review and approval',
      priority: 'medium',
      assignTo: {
        roles: ['technical_approver']
      },
      contextData: {
        requestData: submitEvent.payload,
        requestor: submitEvent.user_id,
        approvalType: 'technical'
      }
    });
    
    // Create legal approval task
    const { taskId: legalTaskId } = await actions.createHumanTask({
      taskType: 'approval',
      title: 'Legal Approval',
      description: 'Legal review and approval',
      priority: 'medium',
      assignTo: {
        roles: ['legal_approver']
      },
      contextData: {
        requestData: submitEvent.payload,
        requestor: submitEvent.user_id,
        approvalType: 'legal'
      }
    });
    
    // Store task IDs
    data.set('approvalTasks', {
      financial: financialTaskId,
      technical: technicalTaskId,
      legal: legalTaskId
    });
    
    // Initialize approval status
    data.set('approvalStatus', {
      financial: null,
      technical: null,
      legal: null
    });
    
    // Wait for all approvals in parallel
    await Promise.all([
      (async () => {
        const financialEvent = await events.waitFor(`Task:${financialTaskId}:Complete`);
        const approved = financialEvent.payload.approved;
        
        // Update approval status
        const approvalStatus = data.get('approvalStatus');
        approvalStatus.financial = {
          approved,
          approver: financialEvent.user_id,
          timestamp: financialEvent.timestamp,
          comments: financialEvent.payload.comments
        };
        data.set('approvalStatus', approvalStatus);
        
        logger.info(`Financial approval: ${approved ? 'Approved' : 'Rejected'}`);
      })(),
      
      (async () => {
        const technicalEvent = await events.waitFor(`Task:${technicalTaskId}:Complete`);
        const approved = technicalEvent.payload.approved;
        
        // Update approval status
        const approvalStatus = data.get('approvalStatus');
        approvalStatus.technical = {
          approved,
          approver: technicalEvent.user_id,
          timestamp: technicalEvent.timestamp,
          comments: technicalEvent.payload.comments
        };
        data.set('approvalStatus', approvalStatus);
        
        logger.info(`Technical approval: ${approved ? 'Approved' : 'Rejected'}`);
      })(),
      
      (async () => {
        const legalEvent = await events.waitFor(`Task:${legalTaskId}:Complete`);
        const approved = legalEvent.payload.approved;
        
        // Update approval status
        const approvalStatus = data.get('approvalStatus');
        approvalStatus.legal = {
          approved,
          approver: legalEvent.user_id,
          timestamp: legalEvent.timestamp,
          comments: legalEvent.payload.comments
        };
        data.set('approvalStatus', approvalStatus);
        
        logger.info(`Legal approval: ${approved ? 'Approved' : 'Rejected'}`);
      })()
    ]);
    
    // Check if all approvals were received
    const approvalStatus = data.get('approvalStatus');
    const allApproved = Object.values(approvalStatus).every(status => status && status.approved);
    
    if (allApproved) {
      // All approvers approved
      await actions.sendNotification({
        recipient: data.get('requestor'),
        template: 'request_approved',
        data: {
          approvals: Object.values(approvalStatus)
        }
      });
      
      // Execute the approved request
      await actions.executeApprovedRequest({
        requestData: data.get('requestData'),
        approvals: Object.values(approvalStatus)
      });
      
      context.setState('approved');
    } else {
      // At least one approver rejected
      const rejections = Object.entries(approvalStatus)
        .filter(([_, status]) => status && !status.approved)
        .map(([type, status]) => ({
          type,
          ...status
        }));
      
      await actions.sendNotification({
        recipient: data.get('requestor'),
        template: 'request_rejected',
        data: {
          rejections
        }
      });
      
      context.setState('rejected');
    }
    
    logger.info('Parallel approval workflow completed');
  }
);
```

### Conditional Approval

A workflow where the approval path depends on the request attributes, such as amount, category, or risk level.

#### Workflow Definition

```typescript
import { defineWorkflow, WorkflowContext } from '../lib/workflow/core/workflowDefinition';

export const conditionalApprovalWorkflow = defineWorkflow(
  'ConditionalApproval',
  async (context: WorkflowContext) => {
    const { actions, events, data, logger } = context;
    
    // Initial state - Processing
    context.setState('processing');
    
    // The workflow is triggered by a Submit event, which is passed as input
    const { triggerEvent } = context.input;
    const requestData = triggerEvent.payload;
    
    // Store request data
    data.set('requestData', requestData);
    data.set('requestor', triggerEvent.user_id);
    
    // Determine approval path based on request attributes
    let approvalPath;
    
    if (requestData.amount <= 1000) {
      // Low value - requires only team lead approval
      approvalPath = 'team_lead_only';
    } else if (requestData.amount <= 10000) {
      // Medium value - requires team lead and manager approval
      approvalPath = 'team_lead_and_manager';
    } else {
      // High value - requires team lead, manager, and director approval
      approvalPath = 'full_approval_chain';
    }
    
    // Additional conditions
    if (requestData.category === 'legal') {
      // Legal requests always require legal review
      approvalPath = 'legal_review';
    } else if (requestData.risk_level === 'high') {
      // High risk requests always require full approval chain
      approvalPath = 'full_approval_chain';
    }
    
    // Store approval path
    data.set('approvalPath', approvalPath);
    logger.info(`Selected approval path: ${approvalPath}`);
    
    // Execute the selected approval path
    switch (approvalPath) {
      case 'team_lead_only':
        await executeTeamLeadOnlyPath(context);
        break;
      case 'team_lead_and_manager':
        await executeTeamLeadAndManagerPath(context);
        break;
      case 'legal_review':
        await executeLegalReviewPath(context);
        break;
      case 'full_approval_chain':
        await executeFullApprovalChainPath(context);
        break;
      default:
        throw new Error(`Unknown approval path: ${approvalPath}`);
    }
    
    logger.info('Conditional approval workflow completed');
  }
);

// Helper functions for different approval paths

async function executeTeamLeadOnlyPath(context) {
  const { actions, events, data } = context;
  
  context.setState('pending_team_lead_approval');
  
  const { taskId } = await actions.createHumanTask({
    taskType: 'approval',
    title: 'Team Lead Approval',
    description: 'Approval for low-value request',
    priority: 'low',
    assignTo: {
      roles: ['team_lead']
    },
    contextData: {
      requestData: data.get('requestData'),
      requestor: data.get('requestor'),
      approvalPath: 'team_lead_only'
    }
  });
  
  const approvalEvent = await events.waitFor(`Task:${taskId}:Complete`);
  
  if (approvalEvent.payload.approved) {
    await actions.sendNotification({
      recipient: data.get('requestor'),
      template: 'request_approved',
      data: {
        approver: approvalEvent.user_id,
        comments: approvalEvent.payload.comments
      }
    });
    
    await actions.executeApprovedRequest({
      requestData: data.get('requestData'),
      approval: {
        approver: approvalEvent.user_id,
        timestamp: approvalEvent.timestamp,
        comments: approvalEvent.payload.comments
      }
    });
    
    context.setState('approved');
  } else {
    await actions.sendNotification({
      recipient: data.get('requestor'),
      template: 'request_rejected',
      data: {
        approver: approvalEvent.user_id,
        comments: approvalEvent.payload.comments
      }
    });
    
    context.setState('rejected');
  }
}

async function executeTeamLeadAndManagerPath(context) {
  const { actions, events, data } = context;
  
  // Team Lead approval
  context.setState('pending_team_lead_approval');
  
  const { taskId: teamLeadTaskId } = await actions.createHumanTask({
    taskType: 'approval',
    title: 'Team Lead Approval',
    description: 'First level approval for medium-value request',
    priority: 'medium',
    assignTo: {
      roles: ['team_lead']
    },
    contextData: {
      requestData: data.get('requestData'),
      requestor: data.get('requestor'),
      approvalPath: 'team_lead_and_manager'
    }
  });
  
  const teamLeadEvent = await events.waitFor(`Task:${teamLeadTaskId}:Complete`);
  
  if (!teamLeadEvent.payload.approved) {
    await actions.sendNotification({
      recipient: data.get('requestor'),
      template: 'request_rejected',
      data: {
        level: 'Team Lead',
        comments: teamLeadEvent.payload.comments
      }
    });
    
    context.setState('rejected_by_team_lead');
    return;
  }
  
  // Manager approval
  context.setState('pending_manager_approval');
  
  const { taskId: managerTaskId } = await actions.createHumanTask({
    taskType: 'approval',
    title: 'Manager Approval',
    description: 'Second level approval for medium-value request',
    priority: 'medium',
    assignTo: {
      roles: ['manager']
    },
    contextData: {
      requestData: data.get('requestData'),
      requestor: data.get('requestor'),
      teamLeadApproval: {
        approver: teamLeadEvent.user_id,
        timestamp: teamLeadEvent.timestamp,
        comments: teamLeadEvent.payload.comments
      }
    }
  });
  
  const managerEvent = await events.waitFor(`Task:${managerTaskId}:Complete`);
  
  if (managerEvent.payload.approved) {
    await actions.sendNotification({
      recipient: data.get('requestor'),
      template: 'request_approved',
      data: {
        approvals: [
          {
            level: 'Team Lead',
            approver: teamLeadEvent.user_id,
            comments: teamLeadEvent.payload.comments
          },
          {
            level: 'Manager',
            approver: managerEvent.user_id,
            comments: managerEvent.payload.comments
          }
        ]
      }
    });
    
    await actions.executeApprovedRequest({
      requestData: data.get('requestData'),
      approvals: [
        {
          level: 'Team Lead',
          approver: teamLeadEvent.user_id,
          timestamp: teamLeadEvent.timestamp,
          comments: teamLeadEvent.payload.comments
        },
        {
          level: 'Manager',
          approver: managerEvent.user_id,
          timestamp: managerEvent.timestamp,
          comments: managerEvent.payload.comments
        }
      ]
    });
    
    context.setState('approved');
  } else {
    await actions.sendNotification({
      recipient: data.get('requestor'),
      template: 'request_rejected',
      data: {
        level: 'Manager',
        comments: managerEvent.payload.comments
      }
    });
    
    context.setState('rejected_by_manager');
  }
}

// Additional approval path implementations would follow the same pattern
```

## Request and Fulfillment Workflows

### Credit Reimbursement

A workflow for processing credit reimbursement requests.

#### Workflow Definition

```typescript
import { defineWorkflow, WorkflowContext } from '../lib/workflow/core/workflowDefinition';

export const creditReimbursementWorkflow = defineWorkflow(
  'CreditReimbursement',
  async (context: WorkflowContext) => {
    const { actions, events, data, logger } = context;
    
    // Initial state
    context.setState('processing');
    
    // The workflow is triggered by a Submit event, which is passed as input
    const { triggerEvent } = context.input;
    const requestData = triggerEvent.payload;
    
    // Store request data
    data.set('requestData', requestData);
    data.set('requestor', triggerEvent.user_id);
    data.set('submissionDate', triggerEvent.timestamp);
    
    // Validate customer information
    context.setState('validating');
    
    const validationResult = await actions.validateCustomerInformation({
      customerId: requestData.customer,
      amount: requestData.amount
    });
    
    if (!validationResult.valid) {
      // Customer validation failed
      await actions.sendNotification({
        recipient: submitEvent.user_id,
        template: 'validation_failed',
        data: {
          reason: validationResult.reason
        }
      });
      
      context.setState('validation_failed');
      return;
    }
    
    // Store customer information
    data.set('customerInfo', validationResult.customerInfo);
    
    // Create approval task
    context.setState('pending_approval');
    
    const { taskId } = await actions.createHumanTask({
      taskType: 'credit_approval',
      title: 'Approve Credit Reimbursement',
      description: `Review and approve credit reimbursement request for ${requestData.customer}`,
      priority: requestData.amount > 1000 ? 'high' : 'medium',
      dueDate: '3 days',
      assignTo: {
        roles: ['finance_approver']
      },
      contextData: {
        requestData,
        customerInfo: validationResult.customerInfo
      }
    });
    
    // Wait for approval decision
    const approvalEvent = await events.waitFor(`Task:${taskId}:Complete`);
    const { approved, adjustedAmount, reason, comments } = approvalEvent.payload;
    
    if (!approved) {
      // Request rejected
      await actions.sendNotification({
        recipient: submitEvent.user_id,
        template: 'reimbursement_rejected',
        data: {
          reason,
          comments
        }
      });
      
      context.setState('rejected');
      return;
    }
    
    // Store approval information
    data.set('approvalInfo', {
      approver: approvalEvent.user_id,
      timestamp: approvalEvent.timestamp,
      adjustedAmount: adjustedAmount || requestData.amount,
      comments
    });
    
    // Process reimbursement
    context.setState('processing');
    
    const finalAmount = adjustedAmount || requestData.amount;
    
    const processingResult = await actions.processReimbursement({
      customerId: requestData.customer,
      amount: finalAmount,
      reason: requestData.reason,
      approver: approvalEvent.user_id,
      reference: `REIMB-${context.executionId}`
    });
    
    if (processingResult.success) {
      // Reimbursement processed successfully
      await actions.sendNotification({
        recipient: submitEvent.user_id,
        template: 'reimbursement_processed',
        data: {
          amount: finalAmount,
          transactionId: processingResult.transactionId,
          processingDate: processingResult.timestamp
        }
      });
      
      // Send notification to customer
      await actions.sendNotification({
        recipient: validationResult.customerInfo.email,
        template: 'customer_reimbursement_notification',
        data: {
          amount: finalAmount,
          reason: requestData.reason,
          processingDate: processingResult.timestamp
        }
      });
      
      // Update accounting records
      await actions.updateAccountingRecords({
        type: 'credit_reimbursement',
        customerId: requestData.customer,
        amount: finalAmount,
        transactionId: processingResult.transactionId,
        approver: approvalEvent.user_id
      });
      
      context.setState('completed');
    } else {
      // Reimbursement processing failed
      await actions.sendNotification({
        recipient: submitEvent.user_id,
        template: 'reimbursement_failed',
        data: {
          reason: processingResult.reason
        }
      });
      
      // Create manual intervention task
      await actions.createHumanTask({
        taskType: 'manual_intervention',
        title: 'Manual Reimbursement Processing Required',
        description: `Automated reimbursement processing failed for ${requestData.customer}. Manual intervention required.`,
        priority: 'high',
        dueDate: '1 day',
        assignTo: {
          roles: ['finance_operations']
        },
        contextData: {
          requestData,
          customerInfo: validationResult.customerInfo,
          approvalInfo: data.get('approvalInfo'),
          processingError: processingResult.reason
        }
      });
      
      context.setState('manual_intervention_required');
    }
    
    logger.info('Credit reimbursement workflow completed');
  }
);
```

#### Form Definitions

```typescript
// Credit reimbursement request form
const creditReimbursementRequestForm = {
  formId: 'credit-reimbursement-request',
  name: 'Credit Reimbursement Request',
  description: 'Form for requesting credit reimbursements',
  version: '1.0.0',
  category: 'finance',
  status: FormStatus.ACTIVE,
  jsonSchema: {
    type: 'object',
    required: ['customer', 'amount', 'reason'],
    properties: {
      customer: {
        type: 'string',
        title: 'Customer Name'
      },
      amount: {
        type: 'number',
        title: 'Amount',
        minimum: 0
      },
      reason: {
        type: 'string',
        title: 'Reason for Reimbursement'
      },
      date: {
        type: 'string',
        format: 'date',
        title: 'Date of Transaction'
      },
      orderNumber: {
        type: 'string',
        title: 'Order Number (if applicable)'
      }
    }
  },
  uiSchema: {
    customer: {
      'ui:widget': 'CompanyPickerWidget',
      'ui:autofocus': true
    },
    amount: {
      'ui:widget': 'currencyWidget'
    },
    reason: {
      'ui:widget': 'textarea'
    },
    date: {
      'ui:widget': 'date'
    }
  }
};

// Credit approval form
const creditApprovalForm = {
  formId: 'credit-approval-form',
  name: 'Credit Approval Form',
  description: 'Form for approving credit reimbursements',
  version: '1.0.0',
  category: 'finance',
  status: FormStatus.ACTIVE,
  jsonSchema: {
    type: 'object',
    required: ['approved'],
    properties: {
      approved: {
        type: 'boolean',
        title: 'Approve this reimbursement?',
        default: false
      },
      adjustedAmount: {
        type: 'number',
        title: 'Adjusted Amount (if different from requested amount)'
      },
      reason: {
        type: 'string',
        title: 'Reason for Adjustment/Rejection'
      },
      comments: {
        type: 'string',
        title: 'Comments'
      }
    }
  },
  uiSchema: {
    approved: {
      'ui:widget': 'checkbox'
    },
    adjustedAmount: {
      'ui:widget': 'currencyWidget',
      'ui:displayIf': {
        field: 'approved',
        value: true
      }
    },
    reason: {
      'ui:widget': 'textarea',
      'ui:displayIf': {
        or: [
          { field: 'approved', value: false },
          { field: 'adjustedAmount', not: null }
        ]
      }
    },
    comments: {
      'ui:widget': 'textarea'
    }
  }
};
```

## Review and Feedback Workflows

### Document Review

A workflow for reviewing and approving documents.

#### Workflow Definition

```typescript
import { defineWorkflow, WorkflowContext } from '../lib/workflow/core/workflowDefinition';

export const documentReviewWorkflow = defineWorkflow(
  'DocumentReview',
  async (context: WorkflowContext) => {
    const { actions, events, data, logger } = context;
    
    // Initial state
    context.setState('processing');
    
    // The workflow is triggered by a Submit event, which is passed as input
    const { triggerEvent } = context.input;
    const documentData = triggerEvent.payload;
    
    // Store document data
    data.set('documentData', documentData);
    data.set('author', triggerEvent.user_id);
    data.set('version', '1.0');
    
    // Determine reviewers based on document type
    let reviewers;
    
    switch (documentData.type) {
      case 'technical':
        reviewers = ['technical_reviewer'];
        break;
      case 'legal':
        reviewers = ['legal_reviewer'];
        break;
      case 'financial':
        reviewers = ['financial_reviewer'];
        break;
      case 'marketing':
        reviewers = ['marketing_reviewer'];
        break;
      default:
        reviewers = ['general_reviewer'];
    }
    
    // Add additional reviewers for sensitive documents
    if (documentData.sensitivity === 'high') {
      reviewers.push('compliance_reviewer');
    }
    
    // Store reviewers
    data.set('reviewers', reviewers);
    
    // Create review tasks for all reviewers
    context.setState('in_review');
    
    const reviewTasks = [];
    
    for (const reviewer of reviewers) {
      const { taskId } = await actions.createHumanTask({
        taskType: 'document_review',
        title: `Review ${documentData.title}`,
        description: `Please review the document: ${documentData.description}`,
        priority: documentData.priority || 'medium',
        dueDate: documentData.dueDate || '5 days',
        assignTo: {
          roles: [reviewer]
        },
        contextData: {
          documentData,
          author: submitEvent.user_id,
          documentUrl: documentData.url
        }
      });
      
      reviewTasks.push({
        taskId,
        reviewer
      });
    }
    
    // Store review tasks
    data.set('reviewTasks', reviewTasks);
    
    // Initialize review results
    data.set('reviewResults', []);
    
    // Wait for all reviews to complete
    for (const task of reviewTasks) {
      const reviewEvent = await events.waitFor(`Task:${task.taskId}:Complete`);
      
      // Store review result
      const reviewResults = data.get('reviewResults');
      reviewResults.push({
        reviewer: task.reviewer,
        reviewerId: reviewEvent.user_id,
        timestamp: reviewEvent.timestamp,
        approved: reviewEvent.payload.approved,
        comments: reviewEvent.payload.comments,
        changes: reviewEvent.payload.changes
      });
      data.set('reviewResults', reviewResults);
      
      logger.info(`Review completed by ${task.reviewer}: ${reviewEvent.payload.approved ? 'Approved' : 'Changes requested'}`);
    }
    
    // Check if all reviewers approved
    const reviewResults = data.get('reviewResults');
    const allApproved = reviewResults.every(result => result.approved);
    
    if (allApproved) {
      // All reviewers approved
      await actions.sendNotification({
        recipient: data.get('author'),
        template: 'document_approved',
        data: {
          document: documentData.title,
          reviewers: reviewResults.map(r => r.reviewerId)
        }
      });
      
      // Update document status
      await actions.updateDocumentStatus({
        documentId: documentData.id,
        status: 'approved',
        version: data.get('version'),
        approvers: reviewResults.map(r => r.reviewerId)
      });
      
      context.setState('approved');
    } else {
      // Changes requested by at least one reviewer
      const changesRequested = reviewResults.filter(result => !result.approved);
      
      await actions.sendNotification({
        recipient: data.get('author'),
        template: 'document_changes_requested',
        data: {
          document: documentData.title,
          changesRequested
        }
      });
      
      // Update document status
      await actions.updateDocumentStatus({
        documentId: documentData.id,
        status: 'changes_requested',
        version: data.get('version'),
        changesRequested
      });
      
      context.setState('changes_requested');
      
      // The workflow will be re-triggered when a DocumentRevision event occurs
      // This would be a separate workflow execution with the revision event as input
      logger.info('Waiting for document revision');
      
      // Note: In a real implementation, we would end this workflow here
      // and start a new workflow instance when the DocumentRevision event occurs
      
      // Restart review process with the same reviewers
      // This could be implemented as a recursive call or by jumping back to the review creation step
    }
    
    logger.info('Document review workflow completed');
  }
);
```

## Conclusion

These workflow patterns demonstrate the flexibility and power of the Dynamic Workflow UI System. By leveraging the system's components, you can implement a wide variety of workflows to meet your business needs.

Key benefits of using these patterns:

1. **Consistency**: Standardized approach to common workflow scenarios
2. **Reusability**: Patterns can be reused across different business processes
3. **Maintainability**: Clear separation of concerns makes workflows easier to maintain
4. **Flexibility**: Patterns can be customized to meet specific requirements
5. **Scalability**: Patterns can be extended to handle more complex scenarios

When implementing these patterns, consider the following best practices:

1. **Start Simple**: Begin with the simplest pattern that meets your needs
2. **Modularize**: Break complex workflows into smaller, reusable components
3. **Handle Exceptions**: Include error handling and exception paths
4. **Monitor Performance**: Ensure workflows perform well under load
5. **Document Decisions**: Document the reasoning behind workflow design decisions
6. **Test Thoroughly**: Test workflows with various scenarios and edge cases